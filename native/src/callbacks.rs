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
mod tests {
  use super::*;

  #[test]
  fn oversized_status_lines_are_rejected_before_retention() {
    let mut state = RequestState::default();
    let line = format!(
      "HTTP/1.1 200 {}\r\n",
      "x".repeat(DEFAULT_MAX_RESPONSE_HEADER_SIZE),
    );
    assert_eq!(
      process_header_chunk(&mut state, line.as_bytes(), line.len()),
      0,
    );
    assert!(state.response_header_overflow);
    assert!(state.headers.is_empty());
  }

  #[test]
  fn status_lines_obey_the_exact_header_size_boundary() {
    let line = b"HTTP/1.1 200 OK\r\n";
    let line_bytes = strip_header_line_ending(line).len();
    for limit in [line_bytes - 1, line_bytes] {
      let mut state = RequestState::default();
      state.max_response_header_bytes = limit;
      let result = process_header_chunk(&mut state, line, line.len());
      assert_eq!(state.response_header_overflow, limit < line_bytes);
      assert_eq!(result, if limit < line_bytes { 0 } else { line.len() });
      assert_eq!(state.current_response_header_bytes, line_bytes);
    }
  }

  #[test]
  fn fields_and_trailers_share_the_status_line_budget() {
    let status = b"HTTP/1.1 200 OK\r\n";
    let field = b"X-Test: value\r\n";
    let combined_bytes = strip_header_line_ending(status).len()
      + strip_header_line_ending(field).len();
    for trailer in [false, true] {
      for limit in [combined_bytes - 1, combined_bytes] {
        let mut state = RequestState::default();
        state.max_response_header_bytes = limit;
        assert_eq!(
          process_header_chunk(&mut state, status, status.len()),
          status.len(),
        );
        if trailer {
          assert_eq!(process_header_chunk(&mut state, b"\r\n", 2), 2);
        }
        assert_eq!(
          process_header_chunk(&mut state, field, field.len()),
          if limit < combined_bytes { 0 } else { field.len() },
        );
        assert_eq!(state.response_header_overflow, limit < combined_bytes);
        assert_eq!(state.current_response_header_bytes, combined_bytes);
      }
    }
  }

  #[test]
  fn informational_and_retry_responses_have_separate_header_budgets() {
    for status in [
      "100 Continue",
      "103 Early Hints",
      "401 Unauthorized",
      "407 Proxy Authentication Required",
      "417 Expectation Failed",
    ] {
      let mut state = RequestState::default();
      let line = format!("HTTP/1.1 {status}\r\n");
      let padding_bytes = 64 - strip_header_line_ending(line.as_bytes()).len()
        - b"X-Fill: ".len();
      let field = format!("X-Fill: {}\r\n", "x".repeat(padding_bytes));
      state.max_response_header_bytes = 64;
      for line in [line.as_bytes(), field.as_bytes(), b"\r\n"] {
        assert_eq!(
          process_header_chunk(&mut state, line, line.len()),
          line.len(),
        );
      }
      assert_eq!(state.current_response_header_bytes, 64);
      if !status.starts_with('1') {
        process_debug_event(&mut state, curl_sys::CURLINFO_HEADER_OUT, &[]);
      }
      let final_status = b"HTTP/1.1 200 OK\r\n";
      assert_eq!(
        process_header_chunk(&mut state, final_status, final_status.len()),
        final_status.len(),
      );
      assert_eq!(
        state.current_response_header_bytes,
        strip_header_line_ending(final_status).len(),
      );
      assert!(!state.response_header_overflow);
    }
  }

  #[test]
  fn final_upload_progress_retains_bounded_allowance_without_renewal() {
    let bytes: curl_off_t = 128 * 1024;
    // Unknown totals must behave the same as a known, completed upload.
    for total in [0, bytes] {
      let mut state = RequestState::default();
      state.upload_allowance = RateLimitAllowance::new(64 * 1024, Instant::now());
      let state_pointer = (&mut state as *mut RequestState).cast::<c_void>();
      assert_eq!(
        transfer_progress_callback(state_pointer, 0, 0, total, bytes),
        0,
      );
      let uploaded_at = state.last_activity;
      assert_eq!(
        state.upload_allowance
          .idle_elapsed(uploaded_at + Duration::from_millis(1_999)),
        Some(Duration::ZERO),
      );
      // A later callback reporting completion again must not clear the debt,
      // earn it twice, or masquerade as fresh socket activity.
      assert_eq!(
        transfer_progress_callback(state_pointer, 0, 0, total, bytes),
        0,
      );
      assert_eq!(state.last_activity, uploaded_at);
      assert_eq!(
        state.upload_allowance
          .idle_elapsed(uploaded_at + Duration::from_millis(1_999)),
        Some(Duration::ZERO),
      );
      assert_eq!(
        state.upload_allowance
          .idle_elapsed(uploaded_at + Duration::from_millis(2_200)),
        Some(Duration::from_millis(200)),
      );
    }
  }

  #[test]
  fn response_deadline_rearms_before_the_next_status_line() {
    let mut state = RequestState::default();
    state.response_timeout = Some(Duration::from_millis(10));
    state.response_started = Instant::now() - Duration::from_secs(1);
    state.final_headers_received = true;
    assert!(!state.check_response_timeout());
    let state_pointer = (&mut state as *mut RequestState).cast::<c_void>();
    request_debug_callback(
      ptr::null_mut(),
      curl_sys::CURLINFO_HEADER_OUT,
      ptr::null_mut(),
      0,
      state_pointer,
    );
    assert!(!state.final_headers_received);
    assert!(state.response_timed_out);
  }

  #[test]
  fn header_callback_cannot_hide_an_expired_deadline() {
    let mut state = RequestState::default();
    state.response_timeout = Some(Duration::from_millis(10));
    state.response_started = Instant::now() - Duration::from_secs(1);
    let line = b"HTTP/1.1 200 OK\r\n";
    assert_eq!(process_header_chunk(&mut state, line, line.len()), 0);
    assert!(state.response_timed_out);
    assert!(!state.stopped_after_final_headers);
  }

  #[test]
  fn request_offsets_are_deduplicated_and_do_not_require_a_timeout() {
    let mut state = RequestState::default();
    process_debug_event(&mut state, curl_sys::CURLINFO_HEADER_OUT, &[]);
    for line in ["HTTP/1.1 200 OK\r\n", "X-Probe: first\r\n", "\r\n"] {
      assert_eq!(
        process_header_chunk(&mut state, line.as_bytes(), line.len()),
        line.len(),
      );
    }
    assert!(state.final_headers_received);
    process_debug_event(&mut state, curl_sys::CURLINFO_HEADER_OUT, &[]);
    process_debug_event(&mut state, curl_sys::CURLINFO_HEADER_OUT, &[]);
    assert_eq!(state.request_header_offsets, vec![0, 3]);
    assert!(!state.final_headers_received);
    assert!(!state.response_timed_out);
  }

  #[test]
  fn ignored_bodies_keep_the_deadline_but_terminal_bodies_do_not() {
    for status in [
      "200 OK",
      "401 Unauthorized",
      "407 Proxy Authentication Required",
    ] {
      for ignored in [false, true] {
        let mut state = RequestState::default();
        state.response_timeout = Some(Duration::from_secs(10));
        let line = format!("HTTP/1.1 {status}\r\n");
        assert_eq!(
          process_header_chunk(&mut state, line.as_bytes(), line.len()),
          line.len(),
        );
        if ignored {
          // libcurl sends this before the final blank header callback.
          process_debug_event(
            &mut state,
            curl_sys::CURLINFO_TEXT,
            b"Ignoring the response-body\n",
          );
        }
        assert_eq!(process_header_chunk(&mut state, b"\r\n", 2), 2);
        assert_eq!(state.final_headers_received, !ignored);
        state.response_started = Instant::now() - Duration::from_secs(11);
        assert_eq!(state.check_response_timeout(), ignored);
      }
    }
  }

  #[test]
  fn stripped_verbose_builds_fail_explicitly_when_tracking_is_required() {
    for has_debug_text in [false, true] {
      let mut state = RequestState::default();
      state.requires_debug_text = true;
      state.current_status_code = Some(401);
      if has_debug_text {
        process_debug_event(&mut state, curl_sys::CURLINFO_TEXT, b"Connected\n");
      }
      let result = process_header_chunk(&mut state, b"\r\n", 2);
      assert_eq!(state.response_tracking_unavailable, !has_debug_text);
      assert_eq!(result, if has_debug_text { 2 } else { 0 });
    }
  }

  #[test]
  fn only_own_handle_informational_events_can_mark_an_ignored_body() {
    let mut state = RequestState::default();
    state.final_headers_received = true;
    let state_pointer = (&mut state as *mut RequestState).cast::<c_void>();
    let mut message = b"Ignoring the response-body\n".to_vec();
    let mut foreign_handle_storage = 0_u8;
    let foreign_handle = (&mut foreign_handle_storage as *mut u8).cast::<CURL>();
    for (handle, kind) in [
      (foreign_handle, curl_sys::CURLINFO_TEXT),
      (ptr::null_mut(), curl_sys::CURLINFO_HEADER_IN),
      (ptr::null_mut(), curl_sys::CURLINFO_DATA_IN),
    ] {
      assert_eq!(
        request_debug_callback(
          handle,
          kind,
          message.as_mut_ptr().cast(),
          message.len(),
          state_pointer,
        ),
        0,
      );
      assert!(!state.response_body_ignored);
      assert!(state.final_headers_received);
      assert!(!state.debug_text_seen);
    }
    assert_eq!(
      request_debug_callback(
        ptr::null_mut(),
        curl_sys::CURLINFO_TEXT,
        message.as_mut_ptr().cast(),
        message.len(),
        state_pointer,
      ),
      0,
    );
    assert!(state.response_body_ignored);
    assert!(!state.final_headers_received);
  }
}
