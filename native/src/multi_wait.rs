use std::os::raw::{c_int, c_long};
use std::ptr;
use std::time::{Duration, Instant};

use curl_sys::{CURLcode, CURLMcode, CURLM, CURLE_FAILED_INIT, CURLE_OPERATION_TIMEDOUT, CURLE_OUT_OF_MEMORY, CURLM_OK, CURLM_OUT_OF_MEMORY};

pub(super) fn multi_error_to_curl(code: CURLMcode) -> CURLcode {
  if code == CURLM_OUT_OF_MEMORY { CURLE_OUT_OF_MEMORY } else { CURLE_FAILED_INIT }
}

const EMPTY_MULTI_WAIT_SLICE: Duration = Duration::from_millis(10);

fn duration_to_wait_ms(duration: Duration) -> c_int {
  duration.as_millis().max(1).min(c_int::MAX as u128) as c_int
}

fn multi_timeout(multi: *mut CURLM) -> std::result::Result<Option<Duration>, CURLcode> {
  let mut timeout_ms: c_long = -1;
  let code = unsafe { curl_sys::curl_multi_timeout(multi, &mut timeout_ms) };
  if code != CURLM_OK { return Err(multi_error_to_curl(code)); }
  if timeout_ms < 0 { Ok(None) } else { Ok(Some(Duration::from_millis(timeout_ms as u64))) }
}

pub(super) fn wait_for_multi(
  multi: *mut CURLM,
  wait_limit: Duration,
) -> std::result::Result<bool, CURLcode> {
  let timeout_ms = duration_to_wait_ms(wait_limit);
  let started_at = Instant::now();
  let mut active_fds = 0;
  let code = unsafe {
    curl_sys::curl_multi_wait(multi, ptr::null_mut(), 0, timeout_ms, &mut active_fds)
  };
  if code != CURLM_OK { return Err(multi_error_to_curl(code)); }
  if active_fds > 0 { return Ok(true); }

  // libcurl may have no descriptors yet; avoid a busy loop but never sleep
  // past a newly due curl timer or the caller's inactivity deadline.
  let remaining_wait = wait_limit.saturating_sub(started_at.elapsed());
  if remaining_wait.is_zero() { return Ok(false); }
  let curl_remaining = multi_timeout(multi)?;
  if curl_remaining == Some(Duration::ZERO) { return Ok(false); }

  let mut sleep_for = remaining_wait.min(EMPTY_MULTI_WAIT_SLICE);
  if let Some(curl_remaining) = curl_remaining {
    sleep_for = sleep_for.min(curl_remaining);
  }
  if !sleep_for.is_zero() {
    std::thread::sleep(sleep_for);
  }
  Ok(false)
}
