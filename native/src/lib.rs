use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_long, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::sync::OnceLock;

use curl_sys::{
  curl_off_t, curl_slist, CURLcode, CURLoption, CURL, CURLE_OK, CURLE_OUT_OF_MEMORY,
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
}

const CURLOPT_MIMEPOST: CURLoption = CURLOPTTYPE_OBJECTPOINT + 269;
static CURL_INIT: OnceLock<CURLcode> = OnceLock::new();
#[cfg(all(unix, not(target_os = "macos")))]
static CA_PROBE: OnceLock<openssl_probe::ProbeResult> = OnceLock::new();

#[derive(Default)]
struct RequestState {
  body: Vec<u8>,
  headers: Vec<String>,
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
}

#[napi(object, object_to_js = false)]
pub struct NativeRequestOptions {
  pub method: String,
  pub url: String,
  pub headers: Option<Vec<String>>,
  pub body: Option<Either<String, Buffer>>,
  pub form: Option<Vec<NativeFormDataEntry>>,
  pub timeout: Option<i64>,
  #[napi(js_name = "noBody")]
  pub no_body: Option<bool>,
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

request_callback!(header_callback, |state: &mut RequestState, chunk: &[u8]| {
  state
    .headers
    .push(String::from_utf8_lossy(trim_header_line(chunk)).into_owned());
});

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
  }

  let code = unsafe { curl_sys::curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime.0) };
  if code != CURLE_OK {
    return Err(code);
  }

  Ok(mime)
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
  let form = options.form.unwrap_or_default();

  let easy = EasyHandle::new()?;
  let curl = easy.0;
  let mut state = Box::new(RequestState::default());
  let state_pointer = (&mut *state as *mut RequestState).cast::<c_void>();
  let mut headers = HeaderList::default();
  let mut mime: Option<Mime> = None;
  let mut keepalive = Vec::<CString>::new();
  let mut code = CURLE_OK;

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
      if options.no_body.unwrap_or(false) { 1 as c_long } else { 0 as c_long },
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

  for header in options.headers.unwrap_or_default() {
    let next = headers.append(&header);
    if next != CURLE_OK {
      code = CURLE_OUT_OF_MEMORY;
      break;
    }
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
    code = unsafe { curl_sys::curl_easy_perform(curl) };
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
    transport_message: curl_error_message(code),
    status_code: status_code as i64,
    effective_url,
    redirect_url,
    headers: std::mem::take(&mut state.headers),
    body: std::mem::take(&mut state.body).into(),
  })
}
