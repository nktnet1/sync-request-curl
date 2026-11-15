use std::os::raw::{c_char, c_int, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::time::{Duration, Instant};

use curl_sys::{curl_off_t, CURLoption, CURL};

use crate::rate_limit::RateLimitAllowance;
use crate::response_tracking::ignores_response_body;

pub(crate) const DEFAULT_MAX_RESPONSE_HEADER_SIZE: usize = 16 * 1024;
pub(crate) const CURLOPT_XFERINFOFUNCTION: CURLoption = 20_000 + 219;
pub(crate) type CurlXferInfoCallback = extern "C" fn(
  *mut c_void,
  curl_off_t,
  curl_off_t,
  curl_off_t,
  curl_off_t,
) -> c_int;

pub(crate) struct RequestState {
  pub(crate) body: Vec<u8>,
  pub(crate) headers: Vec<String>,
  pub(crate) request_header_offsets: Vec<i64>,
  pub(crate) response_body_ignored: bool,
  pub(crate) debug_text_seen: bool,
  pub(crate) requires_debug_text: bool,
  pub(crate) response_tracking_unavailable: bool,
  pub(crate) last_activity: Instant,
  pub(crate) easy_handle: *mut CURL,
  pub(crate) response_started: Instant,
  pub(crate) response_timeout: Option<Duration>,
  pub(crate) response_timed_out: bool,
  pub(crate) download_allowance: RateLimitAllowance,
  pub(crate) upload_allowance: RateLimitAllowance,
  pub(crate) final_headers_received: bool,
  pub(crate) stop_after_final_headers: bool,
  pub(crate) stop_after_redirect_headers: bool,
  pub(crate) current_status_code: Option<u16>,
  pub(crate) current_response_has_location: bool,
  pub(crate) stopped_after_final_headers: bool,
  pub(crate) current_response_header_bytes: usize,
  pub(crate) max_response_header_bytes: usize,
  pub(crate) response_header_overflow: bool,
}

impl Default for RequestState {
  fn default() -> Self {
    Self {
      body: Vec::new(),
      headers: Vec::new(),
      request_header_offsets: Vec::new(),
      response_body_ignored: false,
      debug_text_seen: false,
      requires_debug_text: false,
      response_tracking_unavailable: false,
      last_activity: Instant::now(),
      easy_handle: ptr::null_mut(),
      response_started: Instant::now(),
      response_timeout: None,
      response_timed_out: false,
      download_allowance: RateLimitAllowance::new(0, Instant::now()),
      upload_allowance: RateLimitAllowance::new(0, Instant::now()),
      final_headers_received: false,
      stop_after_final_headers: false,
      stop_after_redirect_headers: false,
      current_status_code: None,
      current_response_has_location: false,
      stopped_after_final_headers: false,
      current_response_header_bytes: 0,
      max_response_header_bytes: DEFAULT_MAX_RESPONSE_HEADER_SIZE,
      response_header_overflow: false,
    }
  }
}

impl RequestState {
  pub(crate) fn mark_activity(&mut self) {
    self.last_activity = Instant::now();
  }

  pub(crate) fn socket_idle_elapsed(&self) -> Duration {
    let now = Instant::now();
    let mut elapsed = now.saturating_duration_since(self.last_activity);
    for allowance in [&self.download_allowance, &self.upload_allowance] {
      if let Some(idle) = allowance.idle_elapsed(now) {
        elapsed = elapsed.min(idle);
      }
    }
    elapsed
  }

  pub(crate) fn check_response_timeout(&mut self) -> bool {
    if !self.final_headers_received
      && self.response_timeout
        .is_some_and(|timeout| self.response_started.elapsed() >= timeout)
    {
      self.response_timed_out = true;
    }
    self.response_timed_out
  }
}
fn handle_request_callback<F>(
  data: *mut c_char,
  size: usize,
  count: usize,
  userdata: *mut c_void,
  handle_chunk: F,
) -> usize
where
  F: FnOnce(&mut RequestState, &[u8], usize) -> usize,
{
  let Some(bytes) = size.checked_mul(count) else {
    return 0;
  };
  if bytes == 0 || data.is_null() || userdata.is_null() {
    return 0;
  }

  catch_unwind(AssertUnwindSafe(|| unsafe {
    let state = &mut *userdata.cast::<RequestState>();
    let chunk = std::slice::from_raw_parts(data.cast::<u8>(), bytes);
    state.mark_activity();
    handle_chunk(state, chunk, bytes)
  }))
  .unwrap_or(0)
}

macro_rules! define_request_callback {
  ($name:ident, $handler:ident) => {
    pub(crate) extern "C" fn $name(
      data: *mut c_char,
      size: usize,
      count: usize,
      userdata: *mut c_void,
    ) -> usize {
      handle_request_callback(data, size, count, userdata, $handler)
    }
  };
}

fn write_response_chunk(state: &mut RequestState, chunk: &[u8], bytes: usize) -> usize {
  state.body.extend_from_slice(chunk);
  bytes
}

define_request_callback!(write_callback, write_response_chunk);

fn header_bytes_to_latin1(bytes: &[u8]) -> String {
  bytes.iter().map(|byte| char::from(*byte)).collect()
}

fn strip_header_line_ending(bytes: &[u8]) -> &[u8] {
  let mut end = bytes.len();
  while end > 0 && matches!(bytes[end - 1], b'\r' | b'\n') {
    end -= 1;
  }
  &bytes[..end]
}

fn trim_header_line(bytes: &[u8]) -> &[u8] {
  let is_space = |byte: u8| matches!(byte, b' ' | b'\t' | b'\r' | b'\n');
  let begin = bytes
    .iter()
    .position(|byte| !is_space(*byte))
    .unwrap_or(bytes.len());
  let end = bytes
    .iter()
    .rposition(|byte| !is_space(*byte))
    .map_or(begin, |index| index + 1);
  &bytes[begin..end]
}

fn parse_http_status_code(line: &[u8]) -> Option<u16> {
  let line = trim_header_line(line);
  if line.len() < 8 || !line[..5].eq_ignore_ascii_case(b"HTTP/") {
    return None;
  }

  let status_start = line.iter().position(|byte| *byte == b' ')? + 1;
  let status = line.get(status_start..status_start + 3)?;
  if !status.iter().all(u8::is_ascii_digit) {
    return None;
  }

  Some(
    u16::from(status[0] - b'0') * 100
      + u16::from(status[1] - b'0') * 10
      + u16::from(status[2] - b'0'),
  )
}

fn is_redirect_status(status_code: u16) -> bool {
  matches!(status_code, 301 | 302 | 303 | 307 | 308)
}

fn is_location_header(line: &[u8]) -> bool {
  line
    .iter()
    .position(|byte| *byte == b':')
    .is_some_and(|separator| line[..separator].eq_ignore_ascii_case(b"location"))
}

fn process_header_chunk(state: &mut RequestState, chunk: &[u8], bytes: usize) -> usize {
  let line = strip_header_line_ending(chunk);

  if let Some(status_code) = parse_http_status_code(line) {
    state.final_headers_received = false;
    state.current_response_header_bytes = 0;
    state.current_status_code = Some(status_code);
    state.current_response_has_location = false;
    state.response_body_ignored = false;
  } else if is_location_header(line) {
    state.current_response_has_location = true;
  }

  // Status lines (including reason phrases), fields, and trailers share the
  // response budget. Check before copying any line into the retained headers.
  state.current_response_header_bytes = state
    .current_response_header_bytes
    .saturating_add(line.len());
  if state.current_response_header_bytes > state.max_response_header_bytes {
    state.response_header_overflow = true;
    return 0;
  }

  // Check inside the callback too: an entire late response can arrive in one
  // multi_perform() call, otherwise hiding the expired deadline from its loop.
  if state.check_response_timeout() {
    return 0;
  }
  state.headers.push(header_bytes_to_latin1(line));

  if line.is_empty()
    && state
      .current_status_code
      .is_some_and(|status_code| !(100..200).contains(&status_code))
  {
    // Fail explicitly on stripped-verbose system builds instead of silently
    // disabling the deadline during an authentication challenge's body.
    if state.requires_debug_text && !state.debug_text_seen {
      state.response_tracking_unavailable = true;
      return 0;
    }
    state.final_headers_received = !state.response_body_ignored;
    let should_stop_for_redirect = state.stop_after_redirect_headers
      && state.current_response_has_location
      && state.current_status_code.is_some_and(is_redirect_status);
    if state.final_headers_received
      && (state.stop_after_final_headers || should_stop_for_redirect)
    {
      state.stopped_after_final_headers = true;
      return 0;
    }
  }

  bytes
}

define_request_callback!(header_callback, process_header_chunk);

fn process_debug_event(
  state: &mut RequestState,
  kind: curl_sys::curl_infotype,
  data: &[u8],
) {
  match kind {
    curl_sys::CURLINFO_HEADER_OUT => {
      let offset = state.headers.len() as i64;
      // Suppressed CONNECT replies or retries before any response can have
      // the same offset. They must not introduce empty response sections.
      if state.request_header_offsets.last() != Some(&offset) {
        state.request_header_offsets.push(offset);
      }
      state.response_body_ignored = false;
      state.final_headers_received = false;
      state.check_response_timeout();
      state.mark_activity();
    }
    curl_sys::CURLINFO_TEXT => {
      state.debug_text_seen |= !data.is_empty();
      if ignores_response_body(data) {
        // Keep the original deadline during draining, not just when the next
        // request is sent. This notification also covers successful probes.
        state.response_body_ignored = true;
        state.final_headers_received = false;
        state.check_response_timeout();
      }
    }
    _ => {}
  }
}

pub(crate) extern "C" fn request_debug_callback(
  curl: *mut CURL,
  kind: curl_sys::curl_infotype,
  data: *mut c_char,
  size: usize,
  user_data: *mut c_void,
) -> c_int {
  // Discard body/TLS events before accessing callback state. No request
  // headers, credentials, or body data are logged or retained.
  if matches!(kind, curl_sys::CURLINFO_HEADER_OUT | curl_sys::CURLINFO_TEXT)
    && !user_data.is_null()
  {
    let _ = catch_unwind(AssertUnwindSafe(|| {
      let state = unsafe { &mut *user_data.cast::<RequestState>() };
      // libcurl can invoke the callback for an internal easy handle as well.
      if state.easy_handle != curl {
        return;
      }
      let chunk = if kind == curl_sys::CURLINFO_TEXT && !data.is_null() {
        unsafe { std::slice::from_raw_parts(data.cast::<u8>(), size) }
      } else {
        &[]
      };
      process_debug_event(state, kind, chunk);
    }));
  }
  0
}

pub(crate) extern "C" fn transfer_progress_callback(
  user_data: *mut c_void,
  _download_total: curl_off_t,
  downloaded: curl_off_t,
  _upload_total: curl_off_t,
  uploaded: curl_off_t,
) -> c_int {
  if user_data.is_null() {
    return 1;
  }
  catch_unwind(AssertUnwindSafe(|| {
    let state = unsafe { &mut *user_data.cast::<RequestState>() };
    let now = Instant::now();
    let received = state.download_allowance.update(downloaded, now);
    let sent = state.upload_allowance.update(uploaded, now);
    if received || sent {
      state.last_activity = now;
    }
    0
  }))
  .unwrap_or(1)
}

#[cfg(test)]
#[path = "callbacks_tests.rs"]
mod tests;
