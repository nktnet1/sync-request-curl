use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_long, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use curl_sys::{
  curl_off_t, curl_slist, CURLcode, CURLoption, CURLMcode, CURL, CURLM,
  CURLE_FAILED_INIT, CURLE_OK, CURLE_OPERATION_TIMEDOUT, CURLE_OUT_OF_MEMORY,
  CURLE_WRITE_ERROR, CURLM_CALL_MULTI_PERFORM, CURLM_OK, CURLM_OUT_OF_MEMORY,
  CURLOPTTYPE_OBJECTPOINT,
};
use napi::bindgen_prelude::{Buffer, Either};
use napi::{Error, Result};
use napi_derive::napi;

mod rate_limit;
mod response_tracking;
use rate_limit::RateLimitAllowance;
use response_tracking::ignores_response_body;

// Public callback ABI (libcurl 7.32.0); older curl-sys bindings omit it.
const CURLOPT_XFERINFOFUNCTION: CURLoption = 20_000 + 219;
type CurlXferInfoCallback = extern "C" fn(
  *mut c_void,
  curl_off_t,
  curl_off_t,
  curl_off_t,
  curl_off_t,
) -> c_int;

// curl-sys intentionally exposes the older form API but not libcurl's MIME API.
// The MIME symbols are part of libcurl's public ABI; keep this small bridge here
// for multipart requests without exposing transport-specific APIs to JavaScript.
#[repr(C)]
struct CurlMime {
  _private: [u8; 0],
}

#[repr(C)]
struct CurlMimePart {
  _private: [u8; 0],
}

unsafe extern "C" {
  fn curl_mime_init(easy: *mut CURL) -> *mut CurlMime;
  fn curl_mime_free(mime: *mut CurlMime);
  fn curl_mime_addpart(mime: *mut CurlMime) -> *mut CurlMimePart;
  fn curl_mime_name(part: *mut CurlMimePart, name: *const c_char) -> CURLcode;
  fn curl_mime_data(
    part: *mut CurlMimePart,
    data: *const c_char,
    data_size: usize,
  ) -> CURLcode;
  fn curl_mime_filename(part: *mut CurlMimePart, filename: *const c_char) -> CURLcode;
  fn curl_mime_type(part: *mut CurlMimePart, mimetype: *const c_char) -> CURLcode;
}

// Public libcurl ABI value; curl-sys leaves this constant commented out.
const CURLE_NOT_BUILT_IN: CURLcode = 4;
const DEFAULT_MAX_RESPONSE_HEADER_SIZE: usize = 16 * 1024;
const RESPONSE_HEADER_OVERFLOW_ERROR: &str =
  "Response headers exceeded the configured size limit";
const RESPONSE_TRACKING_UNAVAILABLE_ERROR: &str =
  "Response header timeouts with negotiated authentication require libcurl verbose strings; use the bundled libcurl build";

const CURLOPT_MIMEPOST: CURLoption = CURLOPTTYPE_OBJECTPOINT + 269;
// Public string-option ABI value, available since libcurl 7.33.0.
// The current curl-sys bindings leave this constant commented out.
const CURLOPT_XOAUTH2_BEARER: CURLoption = CURLOPTTYPE_OBJECTPOINT + 220;
// Public long-option ABI value, available since libcurl 7.54.0.
const CURLOPT_SUPPRESS_CONNECT_HEADERS: CURLoption = 265;
// Public long-option ABI value, available since libcurl 7.37.0.
// The current curl-sys bindings do not export this constant.
const CURLOPT_HEADEROPT: CURLoption = 229;
// Public long-option ABI value, available since libcurl 8.9.0.
// The current curl-sys bindings do not export this constant.
const CURLOPT_TCP_KEEPCNT: CURLoption = 326;
const CURLHEADER_SEPARATE: c_long = 1;
// Public CURLAUTH bit, available since libcurl 7.33.0. The current curl-sys
// bindings do not export it even though the linked libcurl headers do.
const CURLAUTH_BEARER: c_long = 1 << 6;
// Public CURL_HTTP_VERSION enum value, available since libcurl 7.88.0.
// The current curl-sys bindings do not export this constant.
const CURL_HTTP_VERSION_3ONLY: c_long = 31;
// libcurl encodes CURL_SSLVERSION_MAX_* values by shifting the version enum
// into the upper 16 bits; the current curl-sys bindings do not export them.
const CURL_SSLVERSION_MAX_SHIFT: u32 = 16;
const TCP_KEEP_COUNT_UNSUPPORTED_ERROR: &str =
  "TCP keepalive probeCount requires libcurl 8.9.0 or newer and platform support";
static CURL_INIT: OnceLock<CURLcode> = OnceLock::new();
static CONNECTION_POOLS: OnceLock<Mutex<HashMap<i64, Arc<Mutex<MultiHandle>>>>> =
  OnceLock::new();
static NEXT_CONNECTION_POOL_ID: AtomicI64 = AtomicI64::new(1);
#[cfg(all(unix, not(target_os = "macos")))]
static CA_PROBE: OnceLock<openssl_probe::ProbeResult> = OnceLock::new();

struct RequestState {
  body: Vec<u8>,
  headers: Vec<String>,
  request_header_offsets: Vec<i64>,
  response_body_ignored: bool,
  debug_text_seen: bool,
  requires_debug_text: bool,
  response_tracking_unavailable: bool,
  last_activity: Instant,
  easy_handle: *mut CURL,
  response_started: Instant,
  response_timeout: Option<Duration>,
  response_timed_out: bool,
  download_allowance: RateLimitAllowance,
  upload_allowance: RateLimitAllowance,
  final_headers_received: bool,
  stop_after_final_headers: bool,
  stop_after_redirect_headers: bool,
  current_status_code: Option<u16>,
  current_response_has_location: bool,
  stopped_after_final_headers: bool,
  current_response_header_bytes: usize,
  max_response_header_bytes: usize,
  response_header_overflow: bool,
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
  fn mark_activity(&mut self) {
    self.last_activity = Instant::now();
  }

  fn socket_idle_elapsed(&self) -> Duration {
    let now = Instant::now();
    let mut elapsed = now.saturating_duration_since(self.last_activity);
    for allowance in [&self.download_allowance, &self.upload_allowance] {
      if let Some(idle) = allowance.idle_elapsed(now) {
        elapsed = elapsed.min(idle);
      }
    }
    elapsed
  }

  fn check_response_timeout(&mut self) -> bool {
    if !self.final_headers_received
      && self.response_timeout
        .is_some_and(|timeout| self.response_started.elapsed() >= timeout)
    {
      self.response_timed_out = true;
    }
    self.response_timed_out
  }
}

struct EasyHandle(*mut CURL);

impl EasyHandle {
  fn new() -> Result<Self> {
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

struct MultiHandle(*mut CURLM);

// A pool is never used concurrently: every transfer locks its MultiHandle.
// libcurl permits moving handles between threads as long as only one thread
// uses a handle at a time.
unsafe impl Send for MultiHandle {}

impl MultiHandle {
  fn new() -> std::result::Result<Self, CURLcode> {
    let handle = unsafe { curl_sys::curl_multi_init() };
    if handle.is_null() {
      return Err(CURLE_OUT_OF_MEMORY);
    }
    Ok(Self(handle))
  }
}

impl Drop for MultiHandle {
  fn drop(&mut self) {
    unsafe { curl_sys::curl_multi_cleanup(self.0) };
  }
}

#[derive(Default)]
struct HeaderList(*mut curl_slist);

impl HeaderList {
  fn append(&mut self, value: &str) -> CURLcode {
    let value = curl_string(value);
    let next = unsafe { curl_sys::curl_slist_append(self.0, value.as_ptr()) };
    if next.is_null() {
      return CURLE_OUT_OF_MEMORY;
    }
    self.0 = next;
    CURLE_OK
  }
}

fn header_name_matches(header: &str, expected_name: &str) -> bool {
  let delimiter_index = header
    .find(|character| character == ':' || character == ';')
    .unwrap_or(header.len());
  header[..delimiter_index]
    .trim()
    .eq_ignore_ascii_case(expected_name)
}

impl Drop for HeaderList {
  fn drop(&mut self) {
    if !self.0.is_null() {
      unsafe { curl_sys::curl_slist_free_all(self.0) };
    }
  }
}

struct Mime(*mut CurlMime);

impl Mime {
  fn new(curl: *mut CURL) -> std::result::Result<Self, CURLcode> {
    let mime = unsafe { curl_mime_init(curl) };
    if mime.is_null() {
      return Err(CURLE_OUT_OF_MEMORY);
    }
    Ok(Self(mime))
  }
}

impl Drop for Mime {
  fn drop(&mut self) {
    if !self.0.is_null() {
      unsafe { curl_mime_free(self.0) };
    }
  }
}

#[napi(object, object_to_js = false)]
pub struct NativeFormDataEntry {
  pub key: String,
  pub value: Either<String, Buffer>,
  #[napi(js_name = "fileName")]
  pub file_name: Option<String>,
  #[napi(js_name = "contentType")]
  pub content_type: Option<String>,
}

#[napi(object, object_to_js = false)]
pub struct NativeRequestOptions {
  pub method: String,
  pub url: String,
  pub headers: Option<Vec<String>>,
  pub body: Option<Either<String, Buffer>>,
  pub form: Option<Vec<NativeFormDataEntry>>,
  #[napi(js_name = "httpVersion")]
  pub http_version: Option<String>,
  pub family: Option<i64>,
  pub timeout: Option<i64>,
  #[napi(js_name = "connectTimeout")]
  pub connect_timeout: Option<i64>,
  #[napi(js_name = "overallTimeout")]
  pub overall_timeout: Option<i64>,
  #[napi(js_name = "authType")]
  pub auth_type: Option<String>,
  #[napi(js_name = "authUsername")]
  pub auth_username: Option<String>,
  #[napi(js_name = "authPassword")]
  pub auth_password: Option<String>,
  #[napi(js_name = "authBearer")]
  pub auth_bearer: Option<String>,
  pub proxy: Option<String>,
  #[napi(js_name = "proxyUsername")]
  pub proxy_username: Option<String>,
  #[napi(js_name = "proxyPassword")]
  pub proxy_password: Option<String>,
  #[napi(js_name = "proxyAuth")]
  pub proxy_auth: Option<String>,
  #[napi(js_name = "proxyNoProxy")]
  pub proxy_no_proxy: Option<String>,
  #[napi(js_name = "proxyHeaders")]
  pub proxy_headers: Option<Vec<String>>,
  #[napi(js_name = "rejectUnauthorized")]
  pub reject_unauthorized: Option<bool>,
  #[napi(js_name = "caFile")]
  pub ca_file: Option<String>,
  #[napi(js_name = "tlsCertFile")]
  pub tls_cert_file: Option<String>,
  #[napi(js_name = "tlsCertType")]
  pub tls_cert_type: Option<String>,
  #[napi(js_name = "tlsKeyFile")]
  pub tls_key_file: Option<String>,
  #[napi(js_name = "tlsKeyPassphrase")]
  pub tls_key_passphrase: Option<String>,
  #[napi(js_name = "tlsMinVersion")]
  pub tls_min_version: Option<String>,
  #[napi(js_name = "tlsMaxVersion")]
  pub tls_max_version: Option<String>,
  #[napi(js_name = "networkInterface")]
  pub network_interface: Option<String>,
  #[napi(js_name = "localPort")]
  pub local_port: Option<i64>,
  #[napi(js_name = "localPortRange")]
  pub local_port_range: Option<i64>,
  #[napi(js_name = "maxDownloadSpeed")]
  pub max_download_speed: Option<i64>,
  #[napi(js_name = "maxUploadSpeed")]
  pub max_upload_speed: Option<i64>,
  #[napi(js_name = "tcpKeepAlive")]
  pub tcp_keep_alive: Option<bool>,
  #[napi(js_name = "tcpKeepIdle")]
  pub tcp_keep_idle: Option<i64>,
  #[napi(js_name = "tcpKeepInterval")]
  pub tcp_keep_interval: Option<i64>,
  #[napi(js_name = "tcpKeepCount")]
  pub tcp_keep_count: Option<i64>,
  #[napi(js_name = "socketTimeout")]
  pub socket_timeout: Option<i64>,
  #[napi(js_name = "maxResponseHeaderSize")]
  pub max_response_header_size: Option<i64>,
  #[napi(js_name = "noBody")]
  pub no_body: Option<bool>,
  #[napi(js_name = "stopOnRedirectHeaders")]
  pub stop_on_redirect_headers: Option<bool>,
  #[napi(js_name = "connectionPoolId")]
  pub connection_pool_id: Option<i64>,
}

#[napi(object, object_from_js = false, use_nullable = true)]
pub struct NativeResponse {
  #[napi(js_name = "transportCode")]
  pub transport_code: i64,
  #[napi(js_name = "transportMessage")]
  pub transport_message: String,
  #[napi(js_name = "statusCode")]
  pub status_code: i64,
  #[napi(js_name = "effectiveUrl")]
  pub effective_url: Option<String>,
  #[napi(js_name = "redirectUrl")]
  pub redirect_url: Option<String>,
  pub headers: Vec<String>,
  #[napi(js_name = "requestHeaderOffsets")]
  pub request_header_offsets: Vec<i64>,
  pub body: Buffer,
}

fn connection_pools() -> &'static Mutex<HashMap<i64, Arc<Mutex<MultiHandle>>>> {
  CONNECTION_POOLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn multi_error_message(code: CURLMcode) -> String {
  let message = unsafe { curl_sys::curl_multi_strerror(code) };
  if message.is_null() {
    return format!("multi transport error {code}");
  }
  unsafe { CStr::from_ptr(message) }
    .to_string_lossy()
    .into_owned()
}

#[napi(js_name = "createConnectionPool")]
pub fn create_connection_pool(max_connections: i64) -> Result<i64> {
  ensure_curl_initialized()?;
  if max_connections <= 0 {
    return Err(Error::from_reason(
      "Connection pool maxConnections must be greater than zero",
    ));
  }

  let multi =
    MultiHandle::new().map_err(|code| Error::from_reason(curl_error_message(code)))?;
  let code = unsafe {
    curl_sys::curl_multi_setopt(
      multi.0,
      curl_sys::CURLMOPT_MAXCONNECTS,
      max_connections.min(i64::from(c_long::MAX)) as c_long,
    )
  };
  if code != CURLM_OK {
    return Err(Error::from_reason(multi_error_message(code)));
  }

  let pool_id = NEXT_CONNECTION_POOL_ID.fetch_add(1, Ordering::Relaxed);
  let mut pools = connection_pools()
    .lock()
    .map_err(|_| Error::from_reason("Connection pool registry is unavailable"))?;
  pools.insert(pool_id, Arc::new(Mutex::new(multi)));
  Ok(pool_id)
}

#[napi(js_name = "releaseConnectionPool")]
pub fn release_connection_pool(pool_id: i64) {
  if let Ok(mut pools) = connection_pools().lock() {
    pools.remove(&pool_id);
  }
}

fn get_connection_pool(pool_id: i64) -> Option<Arc<Mutex<MultiHandle>>> {
  connection_pools().lock().ok()?.get(&pool_id).cloned()
}

fn curl_string(value: &str) -> CString {
  // std::string::c_str() made embedded NULs visible to libcurl only up to the
  // first NUL. Preserve that behaviour rather than rejecting such JS strings.
  let bytes = value.as_bytes();
  let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
  CString::new(&bytes[..end]).expect("NUL was removed from curl string")
}

fn curl_error_message(code: CURLcode) -> String {
  let message = unsafe { curl_sys::curl_easy_strerror(code) };
  if message.is_null() {
    return format!("transport error {code}");
  }
  unsafe { CStr::from_ptr(message) }
    .to_string_lossy()
    .into_owned()
}

fn transport_error_message(code: CURLcode, error_buffer: &[c_char]) -> String {
  if code != CURLE_OK && error_buffer.first().is_some_and(|value| *value != 0) {
    return unsafe { CStr::from_ptr(error_buffer.as_ptr()) }
      .to_string_lossy()
      .into_owned();
  }

  curl_error_message(code)
}

fn ensure_curl_initialized() -> Result<()> {
  let code = *CURL_INIT.get_or_init(|| unsafe {
    curl_sys::curl_global_init(curl_sys::CURL_GLOBAL_DEFAULT)
  });
  if code == CURLE_OK {
    Ok(())
  } else {
    Err(Error::from_reason(curl_error_message(code)))
  }
}

fn keep_first_error(code: &mut CURLcode, next: CURLcode) {
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

fn set_string_option(
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
fn configure_default_ca(
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
fn configure_default_ca(
  _curl: *mut CURL,
  _keepalive: &mut Vec<CString>,
) -> CURLcode {
  CURLE_OK
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
    extern "C" fn $name(
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
  } else if !line.is_empty() {
    state.current_response_header_bytes = state
      .current_response_header_bytes
      .saturating_add(line.len());
    if state.current_response_header_bytes > state.max_response_header_bytes {
      state.response_header_overflow = true;
      return 0;
    }
    if is_location_header(line) {
      state.current_response_has_location = true;
    }
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

extern "C" fn request_debug_callback(
  curl: *mut CURL,
  kind: curl_sys::curl_infotype,
  data: *mut c_char,
  size: usize,
  user_data: *mut c_void,
) -> c_int {
  // Consume every debug event without logging or retaining credentials/body
  // data. Only HEADER_OUT and libcurl's own retry notification affect state.
  if !user_data.is_null() {
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

extern "C" fn transfer_progress_callback(
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

fn build_mime(
  curl: *mut CURL,
  fields: &[NativeFormDataEntry],
  keepalive: &mut Vec<CString>,
) -> std::result::Result<Mime, CURLcode> {
  let mime = Mime::new(curl)?;

  for field in fields {
    let part = unsafe { curl_mime_addpart(mime.0) };
    if part.is_null() {
      return Err(CURLE_OUT_OF_MEMORY);
    }

    keepalive.push(curl_string(&field.key));
    let name = keepalive.last().expect("just pushed MIME name").as_ptr();
    let mut code = unsafe { curl_mime_name(part, name) };
    if code != CURLE_OK {
      return Err(code);
    }

    let data: &[u8] = match &field.value {
      Either::A(text) => text.as_bytes(),
      Either::B(buffer) => buffer.as_ref(),
    };
    let data_pointer = if data.is_empty() {
      c"".as_ptr()
    } else {
      data.as_ptr().cast::<c_char>()
    };
    code = unsafe { curl_mime_data(part, data_pointer, data.len()) };
    if code != CURLE_OK {
      return Err(code);
    }

    if let Some(file_name) = field
      .file_name
      .as_deref()
      .filter(|value| !value.is_empty())
    {
      keepalive.push(curl_string(file_name));
      let file_name = keepalive
        .last()
        .expect("just pushed MIME filename")
        .as_ptr();
      code = unsafe { curl_mime_filename(part, file_name) };
      if code != CURLE_OK {
        return Err(code);
      }
    }

    if let Some(content_type) = field
      .content_type
      .as_deref()
      .filter(|value| !value.is_empty())
    {
      keepalive.push(curl_string(content_type));
      let content_type = keepalive
        .last()
        .expect("just pushed MIME content type")
        .as_ptr();
      code = unsafe { curl_mime_type(part, content_type) };
      if code != CURLE_OK {
        return Err(code);
      }
    }
  }

  let code = unsafe { curl_sys::curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime.0) };
  if code != CURLE_OK {
    return Err(code);
  }

  Ok(mime)
}

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

fn perform_request(
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

fn parse_http_version(version: Option<&str>) -> Result<c_long> {
  match version.unwrap_or("auto") {
    "auto" => Ok(curl_sys::CURL_HTTP_VERSION_NONE as c_long),
    "1.0" => Ok(curl_sys::CURL_HTTP_VERSION_1_0 as c_long),
    "1.1" => Ok(curl_sys::CURL_HTTP_VERSION_1_1 as c_long),
    "2" => Ok(curl_sys::CURL_HTTP_VERSION_2_0 as c_long),
    "2-tls" => Ok(curl_sys::CURL_HTTP_VERSION_2TLS as c_long),
    "2-prior-knowledge" => Ok(
      curl_sys::CURL_HTTP_VERSION_2_PRIOR_KNOWLEDGE as c_long,
    ),
    "3" => Ok(curl_sys::CURL_HTTP_VERSION_3 as c_long),
    "3-only" => Ok(CURL_HTTP_VERSION_3ONLY),
    value => Err(Error::from_reason(format!(
      "Unsupported HTTP version preference: {value}"
    ))),
  }
}

// The public API follows Node's 0/4/6 family convention while libcurl uses
// CURL_IPRESOLVE_WHATEVER/V4/V6 values 0/1/2.
fn parse_ip_resolve(family: Option<i64>) -> Result<c_long> {
  match family.unwrap_or(0) {
    0 => Ok(curl_sys::CURL_IPRESOLVE_WHATEVER as c_long),
    4 => Ok(curl_sys::CURL_IPRESOLVE_V4 as c_long),
    6 => Ok(curl_sys::CURL_IPRESOLVE_V6 as c_long),
    value => Err(Error::from_reason(format!(
      "Unsupported IP address family: {value}"
    ))),
  }
}

fn parse_tls_cert_type(cert_type: Option<&str>) -> Result<Option<&'static str>> {
  match cert_type {
    Some("pem") => Ok(Some("PEM")),
    Some("p12") => Ok(Some("P12")),
    None => Ok(None),
    Some(value) => Err(Error::from_reason(format!(
      "Unsupported TLS client certificate type: {value}"
    ))),
  }
}

fn parse_tls_version(version: &str) -> Result<c_long> {
  match version {
    "TLSv1.2" => Ok(curl_sys::CURL_SSLVERSION_TLSv1_2 as c_long),
    "TLSv1.3" => Ok(curl_sys::CURL_SSLVERSION_TLSv1_3 as c_long),
    value => Err(Error::from_reason(format!(
      "Unsupported TLS protocol version: {value}"
    ))),
  }
}

fn parse_tls_version_range(
  min_version: Option<&str>,
  max_version: Option<&str>,
) -> Result<Option<c_long>> {
  let min_value = min_version.map(parse_tls_version).transpose()?;
  let max_value = max_version.map(parse_tls_version).transpose()?;
  if min_value.zip(max_value).is_some_and(|(min, max)| min > max) {
    return Err(Error::from_reason(
      "TLS minimum version cannot exceed maximum version",
    ));
  }
  if min_value.is_none() && max_value.is_none() {
    return Ok(None);
  }
  let minimum = min_value.unwrap_or(curl_sys::CURL_SSLVERSION_DEFAULT as c_long);
  let maximum = max_value
    .map(|value| value << CURL_SSLVERSION_MAX_SHIFT)
    .unwrap_or_default();
  Ok(Some(minimum | maximum))
}

#[derive(Clone, Copy)]
enum AuthTarget {
  Http,
  Proxy,
}

fn parse_auth(auth: Option<&str>, target: AuthTarget) -> Result<Option<c_long>> {
  let auth = match auth {
    Some("basic") => curl_sys::CURLAUTH_BASIC as c_long,
    Some("digest") => curl_sys::CURLAUTH_DIGEST as c_long,
    Some("ntlm") => curl_sys::CURLAUTH_NTLM as c_long,
    // curl-sys 0.4.90 exposes libcurl's deprecated alias for CURLAUTH_NEGOTIATE.
    Some("negotiate") => curl_sys::CURLAUTH_GSSNEGOTIATE as c_long,
    Some("any") => curl_sys::CURLAUTH_ANY as c_long,
    Some("bearer") if matches!(target, AuthTarget::Http) => CURLAUTH_BEARER,
    None => return Ok(None),
    Some(value) => {
      let target_name = match target {
        AuthTarget::Http => "HTTP",
        AuthTarget::Proxy => "proxy",
      };
      return Err(Error::from_reason(format!(
        "Unsupported {target_name} authentication method: {value}"
      )));
    }
  };
  Ok(Some(auth))
}

fn has_ascii_control(value: &str) -> bool {
  value.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
}

fn uses_http_credential_restrictions(auth: Option<&str>) -> bool {
  matches!(auth, None | Some("basic" | "digest" | "any"))
}

fn safe_opaque_username(value: &str) -> bool {
  !has_ascii_control(value)
}

fn safe_opaque_password(value: &str) -> bool {
  !value.contains('\0')
}

fn safe_auth_username(value: &str, auth: Option<&str>) -> bool {
  safe_opaque_username(value)
    && !(uses_http_credential_restrictions(auth) && value.contains(':'))
}

fn safe_auth_password(value: &str, auth: Option<&str>) -> bool {
  safe_opaque_password(value)
    && !(uses_http_credential_restrictions(auth) && has_ascii_control(value))
}

fn safe_proxy_username(value: &str, auth: Option<&str>, is_socks: bool) -> bool {
  if is_socks {
    safe_opaque_username(value)
  } else {
    safe_auth_username(value, auth)
  }
}

fn safe_proxy_password(value: &str, auth: Option<&str>, is_socks: bool) -> bool {
  if is_socks {
    safe_opaque_password(value)
  } else {
    safe_auth_password(value, auth)
  }
}

fn is_socks_proxy(proxy: Option<&str>) -> bool {
  let Some(proxy) = proxy else {
    return false;
  };
  let Some((scheme, _)) = proxy.split_once("://") else {
    return false;
  };
  ["socks4", "socks4a", "socks5", "socks5h"]
    .iter()
    .any(|candidate| scheme.eq_ignore_ascii_case(candidate))
}

fn safe_bearer_token(value: &str) -> bool {
  let token = value.trim_end_matches('=');
  !token.is_empty()
    && token.bytes().all(|byte| {
      byte.is_ascii_alphanumeric()
        || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'+' | b'/')
    })
}

fn validate_auth_credentials(options: &NativeRequestOptions) -> Result<()> {
  // Do not let direct native callers bypass the public schema and inject
  // headers, silently truncate credentials, or misparse Basic/Digest names.
  if options
    .auth_username
    .as_deref()
    .is_some_and(|value| !safe_auth_username(value, options.auth_type.as_deref()))
  {
    return Err(Error::from_reason(
      "Invalid authentication username for the selected method",
    ));
  }
  if options
    .auth_password
    .as_deref()
    .is_some_and(|value| !safe_auth_password(value, options.auth_type.as_deref()))
  {
    return Err(Error::from_reason(
      "Invalid authentication password for the selected method",
    ));
  }
  let proxy_is_socks = is_socks_proxy(options.proxy.as_deref());
  if options.proxy_username.as_deref().is_some_and(|value| {
    !safe_proxy_username(value, options.proxy_auth.as_deref(), proxy_is_socks)
  }) {
    return Err(Error::from_reason(
      "Invalid proxy username for the selected method",
    ));
  }
  if options.proxy_password.as_deref().is_some_and(|value| {
    !safe_proxy_password(value, options.proxy_auth.as_deref(), proxy_is_socks)
  }) {
    return Err(Error::from_reason(
      "Invalid proxy password for the selected method",
    ));
  }
  if options.auth_bearer.as_deref()
    .is_some_and(|token| !safe_bearer_token(token))
  {
    return Err(Error::from_reason("Invalid Bearer token"));
  }
  Ok(())
}

fn validate_proxy_headers(
  headers: &[String],
  has_structured_auth: bool,
) -> Result<()> {
  for header in headers {
    // Direct native callers must not smuggle another field behind a safe name.
    if header.bytes().any(|byte| matches!(byte, b'\r' | b'\n' | 0)) {
      return Err(Error::from_reason("Invalid proxy header line"));
    }
    if header_name_matches(header, "content-length")
      || header_name_matches(header, "transfer-encoding")
    {
      return Err(Error::from_reason(
        "Content-Length and Transfer-Encoding cannot be supplied in proxy.headers",
      ));
    }
    if header_name_matches(header, "authorization")
      || header_name_matches(header, "cookie")
    {
      return Err(Error::from_reason(
        "Authorization and Cookie cannot be supplied in proxy.headers",
      ));
    }
    if has_structured_auth && header_name_matches(header, "proxy-authorization") {
      return Err(Error::from_reason(
        "Proxy-Authorization cannot be combined with structured proxy authentication",
      ));
    }
  }
  Ok(())
}

fn uses_negotiated_auth(auth: Option<&str>) -> bool {
  matches!(auth, Some("any" | "digest" | "ntlm" | "negotiate"))
}

fn needs_response_tracking(auth: Option<&str>, proxy_auth: Option<&str>) -> bool {
  uses_negotiated_auth(auth) || uses_negotiated_auth(proxy_auth)
}

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

#[napi]
pub fn request(options: NativeRequestOptions) -> Result<NativeResponse> {
  validate_auth_credentials(&options)?;
  let has_structured_proxy_auth = options.proxy_username.is_some()
    || options.proxy_password.is_some()
    || options.proxy_auth.is_some();
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
  ensure_curl_initialized()?;

  // Keep the original Node Buffer alive for the whole synchronous transfer.
  // napi::Buffer is zero-copy; converting it to Vec<u8> would duplicate large uploads.
  let request_body = options.body;
  let has_form = options.form.is_some();
  let has_request_payload = request_body.is_some() || has_form;
  let form = options.form.unwrap_or_default();
  let request_headers = options.headers.unwrap_or_default();
  let has_content_type = request_headers
    .iter()
    .any(|header| header_name_matches(header, "content-type"));
  let has_accept = request_headers
    .iter()
    .any(|header| header_name_matches(header, "accept"));
  let no_body = options.no_body.unwrap_or(false);

  let http_version = parse_http_version(options.http_version.as_deref())?;
  let ip_resolve = parse_ip_resolve(options.family)?;
  let tls_cert_type = parse_tls_cert_type(options.tls_cert_type.as_deref())?;
  let tls_version = parse_tls_version_range(
    options.tls_min_version.as_deref(),
    options.tls_max_version.as_deref(),
  )?;
  let http_auth = parse_auth(options.auth_type.as_deref(), AuthTarget::Http)?;
  let proxy_auth = parse_auth(options.proxy_auth.as_deref(), AuthTarget::Proxy)?;
  // Callback state must also outlive curl_easy_cleanup(), which can emit
  // debug events. Locals are dropped in reverse declaration order.
  let mut state = Box::new(RequestState::default());
  let easy = EasyHandle::new()?;
  let curl = easy.0;
  state.easy_handle = curl;
  let response_tracking_enabled = needs_response_tracking(
    options.auth_type.as_deref(),
    options.proxy_auth.as_deref(),
  );
  state.requires_debug_text =
    options.timeout.unwrap_or_default() > 0 && response_tracking_enabled;
  state.download_allowance = RateLimitAllowance::new(
    options.max_download_speed.unwrap_or_default(),
    Instant::now(),
  );
  state.upload_allowance = RateLimitAllowance::new(
    options.max_upload_speed.unwrap_or_default(),
    Instant::now(),
  );
  state.stop_after_final_headers = no_body && has_request_payload;
  state.stop_after_redirect_headers = options.stop_on_redirect_headers.unwrap_or(false);
  state.max_response_header_bytes = options
    .max_response_header_size
    .and_then(|value| usize::try_from(value).ok())
    .filter(|value| *value > 0)
    .unwrap_or(DEFAULT_MAX_RESPONSE_HEADER_SIZE);
  let state_pointer = (&mut *state as *mut RequestState).cast::<c_void>();
  let mut error_buffer = vec![0 as c_char; curl_sys::CURL_ERROR_SIZE as usize];
  let mut headers = HeaderList::default();
  let mut proxy_headers = HeaderList::default();
  let mut mime: Option<Mime> = None;
  let mut keepalive = Vec::<CString>::new();
  let mut code = CURLE_OK;

  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_ERRORBUFFER,
      error_buffer.as_mut_ptr(),
    )
  });
  keep_first_error(
    &mut code,
    set_string_option(
      curl,
      curl_sys::CURLOPT_URL,
      Some(&options.url),
      &mut keepalive,
      false,
    ),
  );
  // Do not let libcurl implicitly route requests through process-level
  // http_proxy/HTTPS_PROXY/ALL_PROXY variables. Proxying is an explicit
  // high-level feature and must not change request behaviour ambiently.
  keep_first_error(
    &mut code,
    set_string_option(
      curl,
      curl_sys::CURLOPT_PROXY,
      Some(options.proxy.as_deref().unwrap_or("")),
      &mut keepalive,
      true,
    ),
  );
  keep_first_error(
    &mut code,
    set_string_option(
      curl,
      curl_sys::CURLOPT_CUSTOMREQUEST,
      Some(&options.method),
      &mut keepalive,
      false,
    ),
  );
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HTTP_VERSION, http_version)
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_IPRESOLVE, ip_resolve)
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_CONNECTTIMEOUT_MS,
      options.connect_timeout.unwrap_or_default() as c_long,
    )
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_TIMEOUT_MS,
      options.overall_timeout.unwrap_or_default() as c_long,
    )
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_NOBODY,
      if no_body && !has_request_payload {
        1 as c_long
      } else {
        0 as c_long
      },
    )
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_WRITEFUNCTION,
      write_callback as curl_sys::curl_write_callback,
    )
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_WRITEDATA, state_pointer)
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_HEADERFUNCTION,
      header_callback as curl_sys::curl_write_callback,
    )
  });
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HEADERDATA, state_pointer)
  });
  // Negotiated authentication can produce multiple request/response exchanges
  // inside one easy transfer. Trace only those requests: ordinary transfers do
  // not need verbose callbacks and avoid their per-chunk overhead.
  if response_tracking_enabled {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_DEBUGFUNCTION,
        request_debug_callback as curl_sys::curl_debug_callback,
      )
    });
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_DEBUGDATA, state_pointer)
    });
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_VERBOSE, 1 as c_long)
    });
  }
  if options.socket_timeout.unwrap_or_default() > 0
    && (options.max_download_speed.unwrap_or_default() > 0
      || options.max_upload_speed.unwrap_or_default() > 0)
  {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        CURLOPT_XFERINFOFUNCTION,
        transfer_progress_callback as CurlXferInfoCallback,
      )
    });
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_PROGRESSDATA, state_pointer)
    });
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_NOPROGRESS, 0 as c_long)
    });
  }
  if options.ca_file.is_none() {
    keep_first_error(&mut code, configure_default_ca(curl, &mut keepalive));
  } else {
    // An explicit bundle replaces default directory trust as well.
    let capath_code = unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_CAPATH, ptr::null::<c_char>())
    };
    // Backends without CA-directory support have no directory to clear.
    if capath_code != CURLE_NOT_BUILT_IN {
      keep_first_error(&mut code, capath_code);
    }
  }
  // Authentication credentials are kept separate for the origin and proxy.
  // Explicit proxy routing also overrides ambient NO_PROXY; an empty bypass
  // string means every host uses the configured proxy.
  for (option, value) in [
    (curl_sys::CURLOPT_USERNAME, options.auth_username.as_deref()),
    (curl_sys::CURLOPT_PASSWORD, options.auth_password.as_deref()),
    (CURLOPT_XOAUTH2_BEARER, options.auth_bearer.as_deref()),
    (
      curl_sys::CURLOPT_NOPROXY,
      Some(options.proxy_no_proxy.as_deref().unwrap_or("")),
    ),
    (curl_sys::CURLOPT_PROXYUSERNAME, options.proxy_username.as_deref()),
    (curl_sys::CURLOPT_PROXYPASSWORD, options.proxy_password.as_deref()),
    (curl_sys::CURLOPT_CAINFO, options.ca_file.as_deref()),
    (curl_sys::CURLOPT_SSLCERT, options.tls_cert_file.as_deref()),
    (curl_sys::CURLOPT_SSLCERTTYPE, tls_cert_type),
    (curl_sys::CURLOPT_SSLKEY, options.tls_key_file.as_deref()),
    (curl_sys::CURLOPT_KEYPASSWD, options.tls_key_passphrase.as_deref()),
    (curl_sys::CURLOPT_INTERFACE, options.network_interface.as_deref()),
  ] {
    keep_first_error(
      &mut code,
      set_string_option(curl, option, value, &mut keepalive, true),
    );
  }
  if let Some(value) = tls_version {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_SSLVERSION, value)
    });
  }
  if let Some(value) = http_auth {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HTTPAUTH, value)
    });
  }
  if let Some(value) = proxy_auth {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_PROXYAUTH, value)
    });
  }
  for header in options.proxy_headers.unwrap_or_default() {
    let next = proxy_headers.append(&header);
    if next != CURLE_OK {
      code = CURLE_OUT_OF_MEMORY;
      break;
    }
  }
  if !proxy_headers.0.is_null() {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        CURLOPT_HEADEROPT,
        CURLHEADER_SEPARATE,
      )
    });
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_PROXYHEADER, proxy_headers.0)
    });
  }
  // CONNECT headers belong to the proxy, not the origin. In particular, they
  // must not trigger the HEAD-with-payload early-stop callback.
  keep_first_error(&mut code, unsafe {
    curl_sys::curl_easy_setopt(curl, CURLOPT_SUPPRESS_CONNECT_HEADERS, 1 as c_long)
  });
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
      keep_first_error(&mut code, unsafe {
        curl_sys::curl_easy_setopt(curl, option, value as c_long)
      });
    }
  }
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
      keep_first_error(&mut code, unsafe {
        curl_sys::curl_easy_setopt(curl, option, value as curl_off_t)
      });
    }
  }
  let mut transport_error_override = None;
  if let Some(value) = options.tcp_keep_count {
    let next = unsafe {
      curl_sys::curl_easy_setopt(curl, CURLOPT_TCP_KEEPCNT, value as c_long)
    };
    if code == CURLE_OK
      && (next == curl_sys::CURLE_UNKNOWN_OPTION || next == CURLE_NOT_BUILT_IN)
    {
      transport_error_override = Some(TCP_KEEP_COUNT_UNSUPPORTED_ERROR);
    }
    keep_first_error(&mut code, next);
  }

  for header in request_headers {
    let next = headers.append(&header);
    if next != CURLE_OK {
      code = CURLE_OUT_OF_MEMORY;
      break;
    }
  }
  // libcurl otherwise invents Accept: */*. Absence of Accept has distinct
  // HTTP semantics (no declared media-type preference), and Node does not add
  // this header, so suppress the transport default unless the caller supplied it.
  if code == CURLE_OK && !has_accept {
    code = headers.append("Accept:");
  }

  // CURLOPT_POSTFIELDS otherwise invents application/x-www-form-urlencoded.
  // A raw body has no implied media type, so suppress libcurl's generated
  // Content-Type unless the caller (or JSON preparation) supplied one.
  if code == CURLE_OK && request_body.is_some() && !has_form && !has_content_type {
    code = headers.append("Content-Type:");
  }
  if !headers.0.is_null() {
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HTTPHEADER, headers.0)
    });
  }

  if let Some(body) = &request_body {
    let body: &[u8] = match body {
      Either::A(text) => text.as_bytes(),
      Either::B(buffer) => buffer.as_ref(),
    };
    let body_pointer = if body.is_empty() {
      c"".as_ptr()
    } else {
      body.as_ptr().cast::<c_char>()
    };
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_POSTFIELDSIZE_LARGE,
        body.len() as curl_off_t,
      )
    });
    keep_first_error(&mut code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_POSTFIELDS, body_pointer)
    });
  }

  if code == CURLE_OK && has_form {
    match build_mime(curl, &form, &mut keepalive) {
      Ok(next_mime) => mime = Some(next_mime),
      Err(next_code) => code = next_code,
    }
  }

  if code == CURLE_OK {
    code = perform_request(
      curl,
      state_pointer.cast::<RequestState>(),
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
  }

  let mut status_code: c_long = 0;
  unsafe {
    curl_sys::curl_easy_getinfo(curl, curl_sys::CURLINFO_RESPONSE_CODE, &mut status_code);
  }
  let effective_url = get_string_info(curl, curl_sys::CURLINFO_EFFECTIVE_URL);
  let redirect_url = get_string_info(curl, curl_sys::CURLINFO_REDIRECT_URL);

  // Keep POSTFIELDS, MIME, and string backing storage alive until all libcurl
  // operations above are finished. Explicitly touching them also makes the
  // lifetime requirement obvious to future refactors.
  let _request_body = request_body;
  let _mime = mime;
  let _keepalive = keepalive;

  let transport_message = if state.response_timed_out {
    "Response header timeout exceeded".to_owned()
  } else if state.response_tracking_unavailable {
    RESPONSE_TRACKING_UNAVAILABLE_ERROR.to_owned()
  } else if state.response_header_overflow {
    RESPONSE_HEADER_OVERFLOW_ERROR.to_owned()
  } else if let Some(message) = transport_error_override {
    message.to_owned()
  } else {
    transport_error_message(code, &error_buffer)
  };

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


#[cfg(test)]
mod regression_tests {
  use super::*;

  #[test]
  fn native_credentials_enforce_header_safe_syntax() {
    for control in ['\0', '\r', '\n', '\t', '\x1f', '\x7f'] {
      assert!(!safe_auth_username(&format!("user{control}")));
      assert!(!safe_bearer_token(&format!("token{control}")));
    }
    for token in ["", "=", "token space", "to=ken", "token=\n"] {
      assert!(!safe_bearer_token(token));
    }
    assert!(safe_auth_username(""));
    assert!(safe_auth_username("caf\u{e9}"));
    assert!(safe_bearer_token("a.b_c-~+/=="));
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
  fn native_proxy_headers_cannot_override_request_framing_or_origin_secrets() {
    for header in [
      "Content-Length: 3",
      "content-length;",
      "TRANSFER-ENCODING: chunked",
      "Transfer-Encoding:",
      "Authorization: Bearer secret",
      "Cookie: session=secret",
      "X-Proxy: safe\r\nContent-Length: 999",
      "X-Proxy: safe\nTransfer-Encoding: chunked",
      "X-Proxy: value\0",
    ] {
      assert!(validate_proxy_headers(&[header.to_owned()], false).is_err());
    }
    let proxy_authorization =
      ["Proxy-Authorization: Basic dXNlcjpwYXNz".to_owned()];
    assert!(validate_proxy_headers(&proxy_authorization, false).is_ok());
    assert!(validate_proxy_headers(&proxy_authorization, true).is_err());
    assert!(
      validate_proxy_headers(&["X-Proxy: value".to_owned()], false).is_ok()
    );
    assert!(validate_proxy_headers(&[], false).is_ok());
  }

  #[test]
  fn auth_credential_rules_match_the_selected_method() {
    for auth in [None, Some("basic"), Some("digest"), Some("any")] {
      assert!(!safe_auth_username("user:name", auth));
      assert!(!safe_auth_password("secret\n", auth));
    }
    for auth in [Some("ntlm"), Some("negotiate")] {
      assert!(safe_auth_username("user:name", auth));
      assert!(safe_auth_password("secret\n", auth));
    }
    assert!(!safe_auth_username("user\n", Some("ntlm")));
    assert!(!safe_auth_password("secret\0suffix", Some("ntlm")));
    assert!(safe_proxy_username("user:name", None, true));
    assert!(safe_proxy_password("p:a:ss", None, true));
    assert!(!safe_proxy_username("user\n", None, true));
    assert!(!safe_proxy_password("secret\0suffix", None, true));
  }

  #[test]
  fn response_tracking_is_limited_to_negotiated_authentication() {
    for auth in [Some("any"), Some("digest"), Some("ntlm"), Some("negotiate")] {
      assert!(needs_response_tracking(auth, None));
      assert!(needs_response_tracking(None, auth));
    }
    for auth in [None, Some("basic"), Some("bearer")] {
      assert!(!needs_response_tracking(auth, None));
      assert!(!needs_response_tracking(None, auth));
    }
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
