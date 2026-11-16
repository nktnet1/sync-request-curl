use std::os::raw::c_int;
use std::ptr;
use std::time::{Duration, Instant};

use curl_sys::{CURLcode, CURLMcode, CURL, CURLM, CURLE_FAILED_INIT, CURLE_OPERATION_TIMEDOUT, CURLM_CALL_MULTI_PERFORM, CURLM_OK};

use crate::multi_wait::{multi_error_to_curl, wait_for_multi};

use crate::callbacks::RequestState;
use crate::connection_pool::{get_connection_pool, MultiHandle};

fn multi_perform(multi: *mut CURLM, running_handles: &mut c_int) -> CURLMcode {
  loop {
    let code = unsafe { curl_sys::curl_multi_perform(multi, running_handles) };
    if code != CURLM_CALL_MULTI_PERFORM {
      return code;
    }
  }
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

#[derive(Clone, Copy)]
struct TransferTimeouts {
  response_started: Instant,
  response_timeout: Option<Duration>,
  socket_timeout: Option<Duration>,
}

impl TransferTimeouts {
  fn new(
    response_timeout_ms: i64,
    socket_timeout_ms: i64,
  ) -> std::result::Result<Self, CURLcode> {
    Ok(Self {
      response_started: Instant::now(),
      response_timeout: timeout_duration(response_timeout_ms)?,
      socket_timeout: timeout_duration(socket_timeout_ms)?,
    })
  }

  fn prepare_state(self, state: *mut RequestState) {
    unsafe {
      (*state).last_activity = self.response_started;
      (*state).response_started = self.response_started;
      (*state).response_timeout = self.response_timeout;
    }
  }
}

fn transfer_wait_limit(
  state: *mut RequestState,
  timeouts: TransferTimeouts,
) -> std::result::Result<Duration, CURLcode> {
  let socket_elapsed = unsafe { (*state).socket_idle_elapsed() };
  if timeouts.socket_timeout.is_some_and(|timeout| socket_elapsed >= timeout) {
    return Err(CURLE_OPERATION_TIMEDOUT);
  }
  if unsafe { (*state).check_response_timeout() } {
    return Err(CURLE_OPERATION_TIMEDOUT);
  }
  let mut wait_limit = timeouts.socket_timeout
    .map(|timeout| timeout.saturating_sub(socket_elapsed))
    .unwrap_or(Duration::from_secs(1));
  if unsafe { !(*state).final_headers_received } {
    if let Some(timeout) = timeouts.response_timeout {
      wait_limit = wait_limit.min(timeout.saturating_sub(timeouts.response_started.elapsed()));
    }
  }
  Ok(wait_limit)
}

fn perform_multi_step(
  multi: *mut CURLM,
  state: *mut RequestState,
  timeouts: TransferTimeouts,
  running_handles: &mut c_int,
) -> std::result::Result<(), CURLcode> {
  let wait_limit = transfer_wait_limit(state, timeouts)?;
  if wait_for_multi(multi, wait_limit)? {
    unsafe { (*state).mark_activity() };
  }
  if timeouts.socket_timeout.is_some_and(|timeout| unsafe {
    (*state).socket_idle_elapsed() >= timeout
  }) {
    return Err(CURLE_OPERATION_TIMEDOUT);
  }
  let code = multi_perform(multi, running_handles);
  if code != CURLM_OK { return Err(multi_error_to_curl(code)); }
  if unsafe { (*state).check_response_timeout() } {
    return Err(CURLE_OPERATION_TIMEDOUT);
  }
  Ok(())
}

fn run_multi_transfer(
  curl: *mut CURL,
  multi: *mut CURLM,
  state: *mut RequestState,
  timeouts: TransferTimeouts,
) -> CURLcode {
  let mut running_handles = 0;
  let code = multi_perform(multi, &mut running_handles);
  if code != CURLM_OK { return multi_error_to_curl(code); }
  while running_handles > 0 {
    if let Err(code) = perform_multi_step(multi, state, timeouts, &mut running_handles) {
      return code;
    }
  }
  if unsafe { (*state).response_timed_out } {
    CURLE_OPERATION_TIMEDOUT
  } else {
    read_multi_result(multi, curl)
  }
}

fn perform_with_multi(
  curl: *mut CURL,
  multi: *mut CURLM,
  state: *mut RequestState,
  response_timeout_ms: i64,
  socket_timeout_ms: i64,
) -> CURLcode {
  let timeouts = match TransferTimeouts::new(response_timeout_ms, socket_timeout_ms) {
    Ok(timeouts) => timeouts,
    Err(code) => return code,
  };
  timeouts.prepare_state(state);

  let add_code = unsafe { curl_sys::curl_multi_add_handle(multi, curl) };
  if add_code != CURLM_OK { return multi_error_to_curl(add_code); }
  let result = run_multi_transfer(curl, multi, state, timeouts);
  unsafe { curl_sys::curl_multi_remove_handle(multi, curl) };
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
