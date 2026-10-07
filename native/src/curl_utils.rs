use std::ffi::{CStr, CString};
use std::os::raw::{c_char};
use std::sync::OnceLock;

use curl_sys::{CURLcode, CURLoption, CURL, CURLE_OK};
use napi::{Error, Result};

pub(crate) const CURLE_NOT_BUILT_IN: CURLcode = 4;
static CURL_INIT: OnceLock<CURLcode> = OnceLock::new();
#[cfg(all(unix, not(target_os = "macos")))]
static CA_PROBE: OnceLock<openssl_probe::ProbeResult> = OnceLock::new();

pub(crate) struct EasyHandle(pub(crate) *mut CURL);

impl EasyHandle {
  pub(crate) fn new() -> Result<Self> {
    let handle = unsafe { curl_sys::curl_easy_init() };
    if handle.is_null() {
      return Err(Error::from_reason("curl_easy_init failed"));
    }
    Ok(Self(handle))
  }
}

impl Drop for EasyHandle {
  fn drop(&mut self) {
    unsafe { curl_sys::curl_easy_cleanup(self.0) };
  }
}
pub(crate) fn curl_string(value: &str) -> CString {
  // std::string::c_str() made embedded NULs visible to libcurl only up to the
  // first NUL. Preserve that behaviour rather than rejecting such JS strings.
  let bytes = value.as_bytes();
  let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
  CString::new(&bytes[..end]).expect("NUL was removed from curl string")
}

pub(crate) fn curl_header_string(value: &str) -> Result<CString> {
  // HTTP obs-text is a byte range, not UTF-8. Match Node's Latin-1 header
  // encoding while keeping URLs, credentials, and request bodies in UTF-8.
  let bytes = value
    .chars()
    .map(|character| u8::try_from(u32::from(character)))
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|_| Error::from_reason("Request headers must contain only Latin-1 characters"))?;
  CString::new(bytes)
    .map_err(|_| Error::from_reason("Request headers cannot contain NUL"))
}

pub(crate) fn curl_error_message(code: CURLcode) -> String {
  let message = unsafe { curl_sys::curl_easy_strerror(code) };
  if message.is_null() {
    return format!("transport error {code}");
  }
  unsafe { CStr::from_ptr(message) }
    .to_string_lossy()
    .into_owned()
}

pub(crate) fn transport_error_message(code: CURLcode, error_buffer: &[c_char]) -> String {
  if code != CURLE_OK && error_buffer.first().is_some_and(|value| *value != 0) {
    return unsafe { CStr::from_ptr(error_buffer.as_ptr()) }
      .to_string_lossy()
      .into_owned();
  }

  curl_error_message(code)
}

pub(crate) fn ensure_curl_initialized() -> Result<()> {
  let code = *CURL_INIT.get_or_init(|| unsafe {
    curl_sys::curl_global_init(curl_sys::CURL_GLOBAL_DEFAULT)
  });
  if code == CURLE_OK {
    Ok(())
  } else {
    Err(Error::from_reason(curl_error_message(code)))
  }
}

pub(crate) fn keep_first_error(code: &mut CURLcode, next: CURLcode) {
  if *code == CURLE_OK && next != CURLE_OK {
    *code = next;
  }
}

fn set_string_option_value(
  curl: *mut CURL,
  option: CURLoption,
  value: &str,
  keepalive: &mut Vec<CString>,
) -> CURLcode {
  keepalive.push(curl_string(value));
  let pointer = keepalive
    .last()
    .expect("just pushed curl string")
    .as_ptr();
  unsafe { curl_sys::curl_easy_setopt(curl, option, pointer) }
}

pub(crate) fn set_string_option(
  curl: *mut CURL,
  option: CURLoption,
  value: Option<&str>,
  keepalive: &mut Vec<CString>,
  allow_empty: bool,
) -> CURLcode {
  let Some(value) = value.filter(|value| allow_empty || !value.is_empty()) else {
    return CURLE_OK;
  };

  set_string_option_value(curl, option, value, keepalive)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn configure_default_ca(
  curl: *mut CURL,
  keepalive: &mut Vec<CString>,
) -> CURLcode {
  let probe = CA_PROBE.get_or_init(openssl_probe::probe);
  let mut code = CURLE_OK;
  if let Some(cert_file) = &probe.cert_file {
    let path = cert_file.to_string_lossy();
    keep_first_error(
      &mut code,
      set_string_option(
        curl,
        curl_sys::CURLOPT_CAINFO,
        Some(path.as_ref()),
        keepalive,
        false,
      ),
    );
  }
  if let Some(cert_dir) = probe.cert_dir.first() {
    let path = cert_dir.to_string_lossy();
    keep_first_error(
      &mut code,
      set_string_option(
        curl,
        curl_sys::CURLOPT_CAPATH,
        Some(path.as_ref()),
        keepalive,
        false,
      ),
    );
  }
  code
}

#[cfg(any(not(unix), target_os = "macos"))]
pub(crate) fn configure_default_ca(
  _curl: *mut CURL,
  _keepalive: &mut Vec<CString>,
) -> CURLcode {
  CURLE_OK
}

#[cfg(test)]
mod tests {
  use super::*;

  #[cfg(feature = "bundled-curl-http3")]
  #[test]
  fn bundled_libcurl_reports_http3_support() {
    ensure_curl_initialized().unwrap();
    let info = unsafe { curl_sys::curl_version_info(curl_sys::CURLVERSION_NOW) };
    assert!(!info.is_null());
    let features = unsafe { (*info).features };
    assert_ne!(features & curl_sys::CURL_VERSION_HTTP3, 0);
  }

  #[test]
  fn headers_preserve_latin1_bytes_without_changing_other_curl_strings() {
    let header = "X-Test: caf\u{e9}\u{80}\u{ff}";
    assert_eq!(
      curl_header_string(header).unwrap().as_bytes(),
      b"X-Test: caf\xe9\x80\xff",
    );
    assert_eq!(curl_string(header).as_bytes(), header.as_bytes());
    assert_eq!(curl_header_string("X-Empty;").unwrap().as_bytes(), b"X-Empty;");
  }

  #[test]
  fn headers_reject_unrepresentable_or_truncated_values() {
    for header in ["X-Test: \u{100}", "X-Test: \u{1f600}", "X-Test: value\0suffix"] {
      assert!(curl_header_string(header).is_err());
    }
  }
}
