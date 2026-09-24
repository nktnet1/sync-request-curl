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
use napi::{Error, Result, Status};
use napi_derive::napi;

// curl-sys intentionally exposes the older form API but not libcurl's MIME API.
// The MIME symbols are part of libcurl's public ABI; keep this small bridge here
// so multipart requests retain the same implementation as the former C++ addon.
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
  fn curl_mime_filedata(part: *mut CurlMimePart, filename: *const c_char) -> CURLcode;
  fn curl_mime_type(part: *mut CurlMimePart, mime_type: *const c_char) -> CURLcode;
  fn curl_mime_filename(part: *mut CurlMimePart, filename: *const c_char) -> CURLcode;
}

const CURLOPT_MIMEPOST: CURLoption = CURLOPTTYPE_OBJECTPOINT + 269;

static CURL_INIT: OnceLock<CURLcode> = OnceLock::new();
#[cfg(unix)]
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
pub struct NativeCurlOptions {
  pub proxy: Option<String>,
  #[napi(js_name = "proxyUserPwd")]
  pub proxy_user_pwd: Option<String>,
  #[napi(js_name = "userAgent")]
  pub user_agent: Option<String>,
  pub referer: Option<String>,
  #[napi(js_name = "caInfo")]
  pub ca_info: Option<String>,
  pub interface: Option<String>,
  #[napi(js_name = "dnsServers")]
  pub dns_servers: Option<String>,
  #[napi(js_name = "tcpKeepAlive")]
  pub tcp_keep_alive: Option<bool>,
}

#[napi(object, object_to_js = false)]
pub struct NativePostField {
  pub name: String,
  pub contents: Option<String>,
  pub file: Option<String>,
  #[napi(js_name = "type")]
  pub content_type: Option<String>,
  pub filename: Option<String>,
}

#[napi(object, object_to_js = false)]
pub struct NativeRequestOptions {
  pub method: String,
  pub url: String,
  pub headers: Option<Vec<String>>,
  pub body: Option<Either<String, Buffer>>,
  #[napi(js_name = "formData")]
  pub form_data: Option<Vec<NativePostField>>,
  pub timeout: Option<i64>,
  pub insecure: Option<bool>,
  #[napi(js_name = "noBody")]
  pub no_body: Option<bool>,
  #[napi(js_name = "curlOptions")]
  pub curl_options: Option<NativeCurlOptions>,
}

#[napi(object, object_from_js = false, use_nullable = true)]
pub struct NativeResponse {
  pub code: i64,
  #[napi(js_name = "errorMessage")]
  pub error_message: String,
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
    return format!("libcurl error {code}");
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
) -> CURLcode {
  let Some(value) = value.filter(|value| !value.is_empty()) else {
    return CURLE_OK;
  };

  set_string_option_value(curl, option, value, keepalive)
}

fn set_string_option_allow_empty(
  curl: *mut CURL,
  option: CURLoption,
  value: Option<&str>,
  keepalive: &mut Vec<CString>,
) -> CURLcode {
  let Some(value) = value else {
    return CURLE_OK;
  };

  set_string_option_value(curl, option, value, keepalive)
}

#[cfg(unix)]
fn configure_default_ca(
  curl: *mut CURL,
  custom_ca_info: Option<&str>,
  keepalive: &mut Vec<CString>,
) -> CURLcode {
  if custom_ca_info.is_some_and(|value| !value.is_empty()) {
    return CURLE_OK;
  }

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
      ),
    );
  }
  code
}

#[cfg(not(unix))]
fn configure_default_ca(
  _curl: *mut CURL,
  _custom_ca_info: Option<&str>,
  _keepalive: &mut Vec<CString>,
) -> CURLcode {
  CURLE_OK
}

fn checked_callback_size(size: usize, count: usize) -> Option<usize> {
  size.checked_mul(count)
}

extern "C" fn write_callback(
  data: *mut c_char,
  size: usize,
  count: usize,
  userdata: *mut c_void,
) -> usize {
  let Some(bytes) = checked_callback_size(size, count) else {
    return 0;
  };
  if bytes == 0 {
    return 0;
  }
  if data.is_null() || userdata.is_null() {
    return 0;
  }

  catch_unwind(AssertUnwindSafe(|| unsafe {
    let state = &mut *userdata.cast::<RequestState>();
    let chunk = std::slice::from_raw_parts(data.cast::<u8>(), bytes);
    state.body.extend_from_slice(chunk);
    bytes
  }))
  .unwrap_or(0)
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

extern "C" fn header_callback(
  data: *mut c_char,
  size: usize,
  count: usize,
  userdata: *mut c_void,
) -> usize {
  let Some(bytes) = checked_callback_size(size, count) else {
    return 0;
  };
  if bytes == 0 {
    return 0;
  }
  if data.is_null() || userdata.is_null() {
    return 0;
  }

  catch_unwind(AssertUnwindSafe(|| unsafe {
    let state = &mut *userdata.cast::<RequestState>();
    let chunk = std::slice::from_raw_parts(data.cast::<u8>(), bytes);
    state
      .headers
      .push(String::from_utf8_lossy(trim_header_line(chunk)).into_owned());
    bytes
  }))
  .unwrap_or(0)
}

fn build_mime(
  curl: *mut CURL,
  fields: &[NativePostField],
  keepalive: &mut Vec<CString>,
) -> Result<std::result::Result<Mime, CURLcode>> {
  for field in fields {
    if field.file.is_none() && field.contents.is_none() {
      return Err(Error::new(
        Status::InvalidArg,
        "Missing native request option: contents".to_string(),
      ));
    }
  }

  let mime = match Mime::new(curl) {
    Ok(mime) => mime,
    Err(code) => return Ok(Err(code)),
  };

  for field in fields {
    let part = unsafe { curl_mime_addpart(mime.0) };
    if part.is_null() {
      return Ok(Err(CURLE_OUT_OF_MEMORY));
    }

    keepalive.push(curl_string(&field.name));
    let name = keepalive.last().expect("just pushed MIME name").as_ptr();
    let mut code = unsafe { curl_mime_name(part, name) };
    if code != CURLE_OK {
      return Ok(Err(code));
    }

    if let Some(file) = &field.file {
      keepalive.push(curl_string(file));
      let file = keepalive.last().expect("just pushed MIME file").as_ptr();
      code = unsafe { curl_mime_filedata(part, file) };
      if code != CURLE_OK {
        return Ok(Err(code));
      }

      if let Some(content_type) = field.content_type.as_deref().filter(|value| !value.is_empty()) {
        keepalive.push(curl_string(content_type));
        let content_type = keepalive
          .last()
          .expect("just pushed MIME content type")
          .as_ptr();
        code = unsafe { curl_mime_type(part, content_type) };
        if code != CURLE_OK {
          return Ok(Err(code));
        }
      }

      if let Some(filename) = field.filename.as_deref().filter(|value| !value.is_empty()) {
        keepalive.push(curl_string(filename));
        let filename = keepalive
          .last()
          .expect("just pushed MIME filename")
          .as_ptr();
        code = unsafe { curl_mime_filename(part, filename) };
        if code != CURLE_OK {
          return Ok(Err(code));
        }
      }
      continue;
    }

    let contents = field
      .contents
      .as_deref()
      .expect("validated non-file MIME field has contents");
    code = unsafe {
      curl_mime_data(
        part,
        contents.as_bytes().as_ptr().cast::<c_char>(),
        contents.len(),
      )
    };
    if code != CURLE_OK {
      return Ok(Err(code));
    }
  }

  let code = unsafe { curl_sys::curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime.0) };
  if code != CURLE_OK {
    return Ok(Err(code));
  }

  Ok(Ok(mime))
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

  let request_body = options.body.map(|body| match body {
    Either::A(text) => text.into_bytes(),
    Either::B(buffer) => buffer.to_vec(),
  });
  let has_form_data = options.form_data.is_some();
  let form_data = options.form_data.unwrap_or_default();
  let curl_options = options.curl_options;

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
    ),
  );
  keep_first_error(
    &mut code,
    set_string_option(
      curl,
      curl_sys::CURLOPT_CUSTOMREQUEST,
      Some(&options.method),
      &mut keepalive,
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
      curl_sys::CURLOPT_SSL_VERIFYPEER,
      if options.insecure.unwrap_or(false) { 0 as c_long } else { 1 as c_long },
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
  let custom_ca_info = curl_options
    .as_ref()
    .and_then(|options| options.ca_info.as_deref());
  keep_first_error(
    &mut code,
    configure_default_ca(curl, custom_ca_info, &mut keepalive),
  );

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

  if code == CURLE_OK && has_form_data {
    match build_mime(curl, &form_data, &mut keepalive)? {
      Ok(next_mime) => mime = Some(next_mime),
      Err(next_code) => code = next_code,
    }
  }

  if code == CURLE_OK {
    if let Some(curl_options) = &curl_options {
      keep_first_error(
        &mut code,
        set_string_option_allow_empty(
          curl,
          curl_sys::CURLOPT_PROXY,
          curl_options.proxy.as_deref(),
          &mut keepalive,
        ),
      );
      keep_first_error(
        &mut code,
        set_string_option(
          curl,
          curl_sys::CURLOPT_PROXYUSERPWD,
          curl_options.proxy_user_pwd.as_deref(),
          &mut keepalive,
        ),
      );
      keep_first_error(
        &mut code,
        set_string_option(
          curl,
          curl_sys::CURLOPT_USERAGENT,
          curl_options.user_agent.as_deref(),
          &mut keepalive,
        ),
      );
      keep_first_error(
        &mut code,
        set_string_option(
          curl,
          curl_sys::CURLOPT_REFERER,
          curl_options.referer.as_deref(),
          &mut keepalive,
        ),
      );
      keep_first_error(
        &mut code,
        set_string_option(
          curl,
          curl_sys::CURLOPT_CAINFO,
          curl_options.ca_info.as_deref(),
          &mut keepalive,
        ),
      );
      keep_first_error(
        &mut code,
        set_string_option(
          curl,
          curl_sys::CURLOPT_INTERFACE,
          curl_options.interface.as_deref(),
          &mut keepalive,
        ),
      );
      keep_first_error(
        &mut code,
        set_string_option(
          curl,
          curl_sys::CURLOPT_DNS_SERVERS,
          curl_options.dns_servers.as_deref(),
          &mut keepalive,
        ),
      );
      if curl_options.tcp_keep_alive.unwrap_or(false) {
        keep_first_error(&mut code, unsafe {
          curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_TCP_KEEPALIVE, 1 as c_long)
        });
      }
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

  // Keep MIME and its backing strings alive until all libcurl operations above
  // are finished. Explicitly touching it also makes the lifetime requirement
  // obvious to future refactors.
  let _mime = mime;
  let _keepalive = keepalive;

  Ok(NativeResponse {
    code: i64::from(code),
    error_message: curl_error_message(code),
    status_code: status_code as i64,
    effective_url,
    redirect_url,
    headers: std::mem::take(&mut state.headers),
    body: std::mem::take(&mut state.body).into(),
  })
}
