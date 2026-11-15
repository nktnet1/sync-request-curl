  use super::{
    process_debug_event, process_header_chunk, request_debug_callback,
    strip_header_line_ending, transfer_progress_callback, RequestState,
    DEFAULT_MAX_RESPONSE_HEADER_SIZE,
  };
  use crate::rate_limit::RateLimitAllowance;
  use curl_sys::{curl_off_t, CURL};
  use std::os::raw::c_void;
  use std::ptr;
  use std::time::{Duration, Instant};

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
