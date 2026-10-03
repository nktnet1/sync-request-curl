use std::os::raw::{c_int, c_long};
use std::ptr;
use std::time::{Duration, Instant};

use curl_sys::{CURLcode, CURLMcode, CURL, CURLM, CURLE_FAILED_INIT, CURLE_OPERATION_TIMEDOUT, CURLE_OUT_OF_MEMORY, CURLM_CALL_MULTI_PERFORM, CURLM_OK, CURLM_OUT_OF_MEMORY};

use crate::callbacks::RequestState;
use crate::connection_pool::{get_connection_pool, MultiHandle};

fn multi_error_to_curl(code: CURLMcode) -> CURLcode {
  if code == CURLM_OUT_OF_MEMORY {
    CURLE_OUT_OF_MEMORY
  } else {
    CURLE_FAILED_INIT
  }
}

fn multi_perform(multi: *mut CURLM, running_handles: &mut c_int) -> CURLMcode {
  loop {
    let code = unsafe { curl_sys::curl_multi_perform(multi, running_handles) };
    if code != CURLM_CALL_MULTI_PERFORM {
      return code;
    }
  }
}

const EMPTY_MULTI_WAIT_SLICE: Duration = Duration::from_millis(10);

fn duration_to_wait_ms(duration: Duration) -> c_int {
  duration.as_millis().max(1).min(c_int::MAX as u128) as c_int
}

fn multi_timeout(multi: *mut CURLM) -> std::result::Result<Option<Duration>, CURLcode> {
  let mut timeout_ms: c_long = -1;
  let code = unsafe { curl_sys::curl_multi_timeout(multi, &mut timeout_ms) };
  if code != CURLM_OK {
    return Err(multi_error_to_curl(code));
  }

  if timeout_ms < 0 {
    Ok(None)
  } else {
    Ok(Some(Duration::from_millis(timeout_ms as u64)))
  }
}

fn wait_for_multi(
  multi: *mut CURLM,
  wait_limit: Duration,
) -> std::result::Result<bool, CURLcode> {
  let timeout_ms = duration_to_wait_ms(wait_limit);
  let started_at = Instant::now();
  let mut active_fds = 0;
  let code = unsafe {
    curl_sys::curl_multi_wait(
      multi,
      ptr::null_mut(),
      0,
      timeout_ms,
      &mut active_fds,
    )
  };
  if code != CURLM_OK {
    return Err(multi_error_to_curl(code));
  }
  if active_fds > 0 {
    return Ok(true);
  }

  // curl_multi_wait() is allowed to return immediately when libcurl has no
  // descriptors yet. Avoid a busy loop without hiding a newly due libcurl
  // timer or the caller's inactivity deadline behind a long sleep.
  let remaining_wait = wait_limit.saturating_sub(started_at.elapsed());
  if remaining_wait.is_zero() {
    return Ok(false);
  }

  let curl_remaining = multi_timeout(multi)?;
  if curl_remaining == Some(Duration::ZERO) {
    return Ok(false);
  }

  let mut sleep_for = remaining_wait.min(EMPTY_MULTI_WAIT_SLICE);
  if let Some(curl_remaining) = curl_remaining {
    sleep_for = sleep_for.min(curl_remaining);
  }
  if !sleep_for.is_zero() {
    std::thread::sleep(sleep_for);
  }
  Ok(false)
}

fn read_multi_result(multi: *mut CURLM, curl: *mut CURL) -> CURLcode {
  let mut queued_messages = 0;
  loop {
    let message = unsafe { curl_sys::curl_multi_info_read(multi, &mut queued_messages) };
    if message.is_null() {
      return CURLE_FAILED_INIT;
    }

    let message = unsafe { &*message };
    if message.msg == curl_sys::CURLMSG_DONE && message.easy_handle == curl {
      // curl-sys represents the C union as a pointer-sized field. Read the
      // CURLcode at the field's address, not the pointer's numeric value:
      // on big-endian 64-bit hosts those occupy different halves of the slot.
      return unsafe { ptr::addr_of!(message.data).cast::<CURLcode>().read() };
    }
  }
}

fn timeout_duration(timeout_ms: i64) -> std::result::Result<Option<Duration>, CURLcode> {
  if timeout_ms <= 0 {
    return Ok(None);
  }
  let timeout_ms = u64::try_from(timeout_ms).map_err(|_| CURLE_FAILED_INIT)?;
  Ok(Some(Duration::from_millis(timeout_ms)))
}

fn perform_with_multi(
  curl: *mut CURL,
  multi: *mut CURLM,
  state: *mut RequestState,
  response_timeout_ms: i64,
  socket_timeout_ms: i64,
) -> CURLcode {
  let response_timeout = match timeout_duration(response_timeout_ms) {
    Ok(timeout) => timeout,
    Err(code) => return code,
  };
  let socket_timeout = match timeout_duration(socket_timeout_ms) {
    Ok(timeout) => timeout,
    Err(code) => return code,
  };
  let response_started = Instant::now();
  unsafe {
    (*state).last_activity = response_started;
    (*state).response_started = response_started;
    (*state).response_timeout = response_timeout;
  }

  let add_code = unsafe { curl_sys::curl_multi_add_handle(multi, curl) };
  if add_code != CURLM_OK {
    return multi_error_to_curl(add_code);
  }

  let result = (|| {
    let mut running_handles = 0;
    let mut code = multi_perform(multi, &mut running_handles);
    if code != CURLM_OK {
      return multi_error_to_curl(code);
    }
    while running_handles > 0 {
      let socket_elapsed = unsafe { (*state).socket_idle_elapsed() };
      if socket_timeout.is_some_and(|timeout| socket_elapsed >= timeout) {
        return CURLE_OPERATION_TIMEDOUT;
      }

      let waiting_for_headers = unsafe { !(*state).final_headers_received };
      let response_elapsed = response_started.elapsed();
      if unsafe { (*state).check_response_timeout() } {
        return CURLE_OPERATION_TIMEDOUT;
      }

      let mut wait_limit = socket_timeout
        .map(|timeout| timeout.saturating_sub(socket_elapsed))
        .unwrap_or(Duration::from_secs(1));
      if waiting_for_headers {
        if let Some(timeout) = response_timeout {
          wait_limit = wait_limit.min(timeout.saturating_sub(response_elapsed));
        }
      }

      let socket_activity = match wait_for_multi(multi, wait_limit) {
        Ok(socket_activity) => socket_activity,
        Err(code) => return code,
      };
      if socket_activity {
        unsafe {
          (*state).mark_activity();
        }
      }

      if socket_timeout.is_some_and(|timeout| unsafe {
        (*state).socket_idle_elapsed() >= timeout
      }) {
        return CURLE_OPERATION_TIMEDOUT;
      }

      code = multi_perform(multi, &mut running_handles);
      if code != CURLM_OK {
        return multi_error_to_curl(code);
      }

      if unsafe { (*state).check_response_timeout() } {
        return CURLE_OPERATION_TIMEDOUT;
      }
    }

    if unsafe { (*state).response_timed_out } {
      CURLE_OPERATION_TIMEDOUT
    } else {
      read_multi_result(multi, curl)
    }
  })();

  unsafe {
    curl_sys::curl_multi_remove_handle(multi, curl);
  }
  result
}

pub(crate) fn perform_request(
  curl: *mut CURL,
  state: *mut RequestState,
  response_timeout_ms: i64,
  socket_timeout_ms: i64,
  connection_pool_id: Option<i64>,
) -> CURLcode {
  if let Some(pool_id) = connection_pool_id {
    let Some(pool) = get_connection_pool(pool_id) else {
      return CURLE_FAILED_INIT;
    };
    let Ok(pool) = pool.lock() else {
      return CURLE_FAILED_INIT;
    };
    return perform_with_multi(
      curl,
      pool.0,
      state,
      response_timeout_ms,
      socket_timeout_ms,
    );
  }

  if response_timeout_ms <= 0 && socket_timeout_ms <= 0 {
    return unsafe { curl_sys::curl_easy_perform(curl) };
  }

  let multi = match MultiHandle::new() {
    Ok(multi) => multi,
    Err(code) => return code,
  };
  perform_with_multi(
    curl,
    multi.0,
    state,
    response_timeout_ms,
    socket_timeout_ms,
  )
}
