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

const CURLOPT_MIMEPOST: CURLoption = CURLOPTTYPE_OBJECTPOINT + 269;
static CURL_INIT: OnceLock<CURLcode> = OnceLock::new();
static CONNECTION_POOLS: OnceLock<Mutex<HashMap<i64, Arc<Mutex<MultiHandle>>>>> =
  OnceLock::new();
static NEXT_CONNECTION_POOL_ID: AtomicI64 = AtomicI64::new(1);
#[cfg(all(unix, not(target_os = "macos")))]
static CA_PROBE: OnceLock<openssl_probe::ProbeResult> = OnceLock::new();

struct RequestState {
  body: Vec<u8>,
  headers: Vec<String>,
  last_activity: Instant,
  stop_after_final_headers: bool,
  current_status_code: Option<u16>,
  stopped_after_final_headers: bool,
}

impl Default for RequestState {
  fn default() -> Self {
    Self {
      body: Vec::new(),
      headers: Vec::new(),
      last_activity: Instant::now(),
      stop_after_final_headers: false,
      current_status_code: None,
      stopped_after_final_headers: false,
    }
  }
}

impl RequestState {
  fn mark_activity(&mut self) {
    self.last_activity = Instant::now();
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
  pub timeout: Option<i64>,
  #[napi(js_name = "socketTimeout")]
  pub socket_timeout: Option<i64>,
  #[napi(js_name = "noBody")]
  pub no_body: Option<bool>,
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
  F: FnOnce(&mut RequestState, &[u8]),
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
    handle_chunk(state, chunk);
    bytes
  }))
  .unwrap_or(0)
}

macro_rules! request_callback {
  ($name:ident, $handle_chunk:expr) => {
    extern "C" fn $name(
      data: *mut c_char,
      size: usize,
      count: usize,
      userdata: *mut c_void,
    ) -> usize {
      handle_request_callback(data, size, count, userdata, $handle_chunk)
    }
  };
}

request_callback!(write_callback, |state: &mut RequestState, chunk: &[u8]| {
  state.body.extend_from_slice(chunk);
});

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

extern "C" fn header_callback(
  data: *mut c_char,
  size: usize,
  count: usize,
  userdata: *mut c_void,
) -> usize {
  let Some(bytes) = size.checked_mul(count) else {
    return 0;
  };
  if bytes == 0 {
    return 0;
  }

  catch_unwind(AssertUnwindSafe(|| unsafe {
    let state = &mut *userdata.cast::<RequestState>();
    let chunk = std::slice::from_raw_parts(data.cast::<u8>(), bytes);
    let line = trim_header_line(chunk);
    state.mark_activity();
    state
      .headers
      .push(String::from_utf8_lossy(line).into_owned());

    if let Some(status_code) = parse_http_status_code(line) {
      state.current_status_code = Some(status_code);
    }

    if state.stop_after_final_headers
      && line.is_empty()
      && state
        .current_status_code
        .is_some_and(|status_code| !(100..200).contains(&status_code))
    {
      state.stopped_after_final_headers = true;
      return 0;
    }

    bytes
  }))
  .unwrap_or(0)
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
      return message.data as CURLcode;
    }
  }
}

fn perform_with_multi(
  curl: *mut CURL,
  multi: *mut CURLM,
  state: *mut RequestState,
  socket_timeout_ms: i64,
) -> CURLcode {
  let socket_timeout = if socket_timeout_ms > 0 {
    let Ok(socket_timeout_ms) = u64::try_from(socket_timeout_ms) else {
      return CURLE_FAILED_INIT;
    };
    Some(Duration::from_millis(socket_timeout_ms))
  } else {
    None
  };
  unsafe {
    (*state).last_activity = Instant::now();
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
      let elapsed = unsafe { (*state).last_activity.elapsed() };
      if socket_timeout.is_some_and(|timeout| elapsed >= timeout) {
        return CURLE_OPERATION_TIMEDOUT;
      }

      let wait_limit = socket_timeout
        .map(|timeout| timeout.saturating_sub(elapsed))
        .unwrap_or(Duration::from_secs(1));
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
        (*state).last_activity.elapsed() >= timeout
      }) {
        return CURLE_OPERATION_TIMEDOUT;
      }

      code = multi_perform(multi, &mut running_handles);
      if code != CURLM_OK {
        return multi_error_to_curl(code);
      }
    }

    read_multi_result(multi, curl)
  })();

  unsafe {
    curl_sys::curl_multi_remove_handle(multi, curl);
  }
  result
}

fn perform_request(
  curl: *mut CURL,
  state: *mut RequestState,
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
    return perform_with_multi(curl, pool.0, state, socket_timeout_ms);
  }

  if socket_timeout_ms <= 0 {
    return unsafe { curl_sys::curl_easy_perform(curl) };
  }

  let multi = match MultiHandle::new() {
    Ok(multi) => multi,
    Err(code) => return code,
  };
  perform_with_multi(curl, multi.0, state, socket_timeout_ms)
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
  let no_body = options.no_body.unwrap_or(false);

  let easy = EasyHandle::new()?;
  let curl = easy.0;
  let mut state = Box::new(RequestState::default());
  state.stop_after_final_headers = no_body && has_request_payload;
  let state_pointer = (&mut *state as *mut RequestState).cast::<c_void>();
  let mut error_buffer = vec![0 as c_char; curl_sys::CURL_ERROR_SIZE as usize];
  let mut headers = HeaderList::default();
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
      Some(""),
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
    curl_sys::curl_easy_setopt(
      curl,
      curl_sys::CURLOPT_TIMEOUT_MS,
      options.timeout.unwrap_or_default() as c_long,
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
  keep_first_error(&mut code, configure_default_ca(curl, &mut keepalive));

  for header in request_headers {
    let next = headers.append(&header);
    if next != CURLE_OK {
      code = CURLE_OUT_OF_MEMORY;
      break;
    }
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
      options.socket_timeout.unwrap_or_default(),
      options.connection_pool_id,
    );
    if code == CURLE_WRITE_ERROR && state.stopped_after_final_headers {
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

  Ok(NativeResponse {
    transport_code: i64::from(code),
    transport_message: transport_error_message(code, &error_buffer),
    status_code: status_code as i64,
    effective_url,
    redirect_url,
    headers: std::mem::take(&mut state.headers),
    body: std::mem::take(&mut state.body).into(),
  })
}
