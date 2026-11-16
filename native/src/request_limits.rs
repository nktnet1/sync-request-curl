use std::os::raw::c_long;

use curl_sys::{curl_off_t, CURLcode, CURLoption, CURL, CURLE_OK};

use crate::curl_utils::{keep_first_error, CURLE_NOT_BUILT_IN};
use crate::types::NativeRequestOptions;

const CURLOPT_TCP_KEEPCNT: CURLoption = 326;
const TCP_KEEP_COUNT_UNSUPPORTED_ERROR: &str = "TCP keepalive probeCount requires libcurl 8.9.0 or newer and platform support";

fn configure_long_limits(curl: *mut CURL, code: &mut CURLcode, options: &NativeRequestOptions) {
  let verify = options.reject_unauthorized.unwrap_or(true);
  for (option, value) in [
    (curl_sys::CURLOPT_SSL_VERIFYPEER, Some(if verify { 1 } else { 0 })),
    (curl_sys::CURLOPT_SSL_VERIFYHOST, Some(if verify { 2 } else { 0 })),
    (curl_sys::CURLOPT_LOCALPORT, options.local_port),
    (curl_sys::CURLOPT_LOCALPORTRANGE, options.local_port_range),
    (
      curl_sys::CURLOPT_TCP_KEEPALIVE,
      Some(if options.tcp_keep_alive.unwrap_or(false) { 1 } else { 0 }),
    ),
    (curl_sys::CURLOPT_TCP_KEEPIDLE, options.tcp_keep_idle),
    (curl_sys::CURLOPT_TCP_KEEPINTVL, options.tcp_keep_interval),
  ] {
    if let Some(value) = value {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, option, value as c_long)
      });
    }
  }
}

fn configure_speed_limits(curl: *mut CURL, code: &mut CURLcode, options: &NativeRequestOptions) {
  for (option, value) in [
    (
      curl_sys::CURLOPT_MAX_RECV_SPEED_LARGE,
      options.max_download_speed,
    ),
    (
      curl_sys::CURLOPT_MAX_SEND_SPEED_LARGE,
      options.max_upload_speed,
    ),
  ] {
    if let Some(value) = value {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, option, value as curl_off_t)
      });
    }
  }
}

fn configure_keepalive_count(curl: *mut CURL, code: &mut CURLcode, options: &NativeRequestOptions) -> Option<&'static str> {
  let mut transport_error_override = None;
  if let Some(value) = options.tcp_keep_count {
    let next = unsafe {
      curl_sys::curl_easy_setopt(curl, CURLOPT_TCP_KEEPCNT, value as c_long)
    };
    if *code == CURLE_OK
      && (next == curl_sys::CURLE_UNKNOWN_OPTION || next == CURLE_NOT_BUILT_IN)
    {
      transport_error_override = Some(TCP_KEEP_COUNT_UNSUPPORTED_ERROR);
    }
    keep_first_error(code, next);
  }
  transport_error_override
}

pub(crate) fn configure_request_limits(
  curl: *mut CURL,
  code: &mut CURLcode,
  options: &NativeRequestOptions,
) -> Option<&'static str> {
  configure_long_limits(curl, code, options);
  configure_speed_limits(curl, code, options);
  configure_keepalive_count(curl, code, options)
}
