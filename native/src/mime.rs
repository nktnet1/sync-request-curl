use std::ffi::CString;
use std::os::raw::c_char;

use curl_sys::{CURLcode, CURLoption, CURL, CURLE_OK, CURLE_OUT_OF_MEMORY, CURLOPTTYPE_OBJECTPOINT};
use napi::bindgen_prelude::Either;

use crate::curl_utils::curl_string;
use crate::types::NativeFormDataEntry;

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

pub(crate) struct Mime(*mut CurlMime);

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
pub(crate) fn build_mime(
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
