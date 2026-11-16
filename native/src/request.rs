use std::ffi::CStr;
use std::os::raw::{c_char, c_long};
use std::ptr;
use std::time::Instant;

use curl_sys::{CURLcode, CURL, CURLE_OK, CURLE_OPERATION_TIMEDOUT, CURLE_WRITE_ERROR};
use napi::{Error, Result};

use crate::callbacks::{RequestState, DEFAULT_MAX_RESPONSE_HEADER_SIZE};
use crate::curl_utils::{ensure_curl_initialized, transport_error_message, EasyHandle, CURLE_NOT_BUILT_IN};
use crate::multi::perform_request;
use crate::options::{needs_auth_response_tracking, proxy_url_has_credentials, uses_negotiated_auth, validate_auth_credentials, validate_proxy_headers};
use crate::rate_limit::RateLimitAllowance;
use crate::request_config::{ParsedRequestOptions, RequestSetup};
use crate::types::{NativeRequestOptions, NativeResponse};

const RESPONSE_HEADER_OVERFLOW_ERROR: &str = "Response headers exceeded the configured size limit";
const RESPONSE_TRACKING_UNAVAILABLE_ERROR: &str = "Response header timeouts with negotiated authentication require libcurl verbose strings; use the bundled libcurl build";

fn get_string_info(curl: *mut CURL, info: curl_sys::CURLINFO) -> Option<String> {
  let mut value: *mut c_char = ptr::null_mut();
  unsafe {
    curl_sys::curl_easy_getinfo(curl, info, &mut value);
  }
  if value.is_null() {
    None
  } else {
    Some(unsafe { CStr::from_ptr(value) }.to_string_lossy().into_owned())
  }
}

fn validate_options(options: &NativeRequestOptions) -> Result<()> {
  validate_auth_credentials(options)?;
  let has_structured_proxy_auth = options.proxy_username.is_some()
    || options.proxy_password.is_some()
    || options.proxy_auth.is_some()
    || proxy_url_has_credentials(options.proxy.as_deref());
  validate_proxy_headers(
    options.proxy_headers.as_deref().unwrap_or_default(),
    has_structured_proxy_auth,
  )?;
  if options.no_body.unwrap_or(false)
    && (options.body.is_some() || options.form.is_some())
    && (uses_negotiated_auth(options.auth_type.as_deref())
      || uses_negotiated_auth(options.proxy_auth.as_deref()))
  {
    return Err(Error::from_reason(
      "HEAD requests with a payload cannot use negotiated authentication; omit the payload or use preemptive Basic/Bearer authentication",
    ));
  }
  Ok(())
}

fn prepare_state(state: &mut RequestState, options: &NativeRequestOptions, curl: *mut CURL) {
  // Preserve explicit single-exchange metadata without a debug callback.
  // HEADER_OUT deduplicates this initial offset when tracing is enabled.
  state.request_header_offsets.push(0);
  state.easy_handle = curl;
  state.requires_debug_text = options.timeout.unwrap_or_default() > 0
    && needs_auth_response_tracking(options.auth_type.as_deref(), options.proxy_auth.as_deref());
  state.download_allowance = RateLimitAllowance::new(options.max_download_speed.unwrap_or_default(), Instant::now());
  state.upload_allowance = RateLimitAllowance::new(options.max_upload_speed.unwrap_or_default(), Instant::now());
  state.stop_after_final_headers = options.no_body.unwrap_or(false)
    && (options.body.is_some() || options.form.is_some());
  state.stop_after_redirect_headers = options.stop_on_redirect_headers.unwrap_or(false);
  state.max_response_header_bytes = options.max_response_header_size
    .and_then(|value| usize::try_from(value).ok())
    .filter(|value| *value > 0)
    .unwrap_or(DEFAULT_MAX_RESPONSE_HEADER_SIZE);
}

fn perform_transfer(
  curl: *mut CURL,
  state: &mut RequestState,
  options: &NativeRequestOptions,
  initial_code: CURLcode,
) -> CURLcode {
  if initial_code != CURLE_OK {
    return initial_code;
  }
  let mut code = perform_request(
    curl,
    state as *mut RequestState,
    options.timeout.unwrap_or_default(),
    options.socket_timeout.unwrap_or_default(),
    options.connection_pool_id,
  );
  if state.response_timed_out {
    code = CURLE_OPERATION_TIMEDOUT;
  } else if state.response_tracking_unavailable {
    code = CURLE_NOT_BUILT_IN;
  } else if code == CURLE_WRITE_ERROR && state.stopped_after_final_headers {
    code = CURLE_OK;
  }
  code
}

fn describe_transport(
  state: &RequestState,
  code: CURLcode,
  error_buffer: &[c_char],
  error_override: Option<&'static str>,
) -> String {
  if state.response_timed_out {
    "Response header timeout exceeded".to_owned()
  } else if state.response_tracking_unavailable {
    RESPONSE_TRACKING_UNAVAILABLE_ERROR.to_owned()
  } else if state.response_header_overflow {
    RESPONSE_HEADER_OVERFLOW_ERROR.to_owned()
  } else if let Some(message) = error_override {
    message.to_owned()
  } else {
    transport_error_message(code, error_buffer)
  }
}

pub(crate) fn request(options: NativeRequestOptions) -> Result<NativeResponse> {
  validate_options(&options)?;
  ensure_curl_initialized()?;
  let parsed = ParsedRequestOptions::parse(&options)?;

  // Both the callback state and CURLOPT_ERRORBUFFER must outlive curl_easy_cleanup.
  // They are declared before the handle so reverse declaration order enforces this.
  // The native Buffer remains owned by options until the entire transfer completes.
  let mut state = Box::new(RequestState::default());
  let mut error_buffer = vec![0 as c_char; curl_sys::CURL_ERROR_SIZE as usize];
  let easy = EasyHandle::new()?;
  let curl = easy.0;
  prepare_state(&mut state, &options, curl);
  let state_pointer = (&mut *state as *mut RequestState).cast();
  let mut setup = RequestSetup::new(curl);
  setup.configure(&options, parsed, state_pointer, &mut error_buffer)?;

  let code = perform_transfer(curl, &mut state, &options, setup.code);
  let mut status_code: c_long = 0;
  unsafe {
    curl_sys::curl_easy_getinfo(curl, curl_sys::CURLINFO_RESPONSE_CODE, &mut status_code);
  }
  let effective_url = get_string_info(curl, curl_sys::CURLINFO_EFFECTIVE_URL);
  let redirect_url = get_string_info(curl, curl_sys::CURLINFO_REDIRECT_URL);
  let transport_message = describe_transport(&state, code, &error_buffer, setup.transport_error_override);

  Ok(NativeResponse {
    transport_code: i64::from(code),
    transport_message,
    status_code: status_code as i64,
    effective_url,
    redirect_url,
    headers: std::mem::take(&mut state.headers),
    request_header_offsets: std::mem::take(&mut state.request_header_offsets),
    body: std::mem::take(&mut state.body).into(),
  })
}
