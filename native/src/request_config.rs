use std::ffi::CString;
use std::os::raw::{c_char, c_long, c_void};
use std::ptr;

use curl_sys::{curl_off_t, curl_slist, CURLcode, CURLoption, CURL, CURLE_OK, CURLE_OUT_OF_MEMORY, CURLOPTTYPE_OBJECTPOINT};
use napi::bindgen_prelude::Either;
use napi::Result;

use crate::callbacks::{header_callback, request_debug_callback, transfer_progress_callback, write_callback, CurlXferInfoCallback, CURLOPT_XFERINFOFUNCTION};
use crate::curl_utils::{configure_default_ca, curl_header_string, keep_first_error, set_string_option, CURLE_NOT_BUILT_IN};
use crate::mime::{build_mime, Mime};
use crate::options::{header_name_matches, needs_auth_response_tracking, parse_auth, parse_http_version, parse_ip_resolve, parse_tls_cert_type, parse_tls_version_range, AuthTarget};
use crate::types::NativeRequestOptions;

const CURLOPT_XOAUTH2_BEARER: CURLoption = CURLOPTTYPE_OBJECTPOINT + 220;
const CURLOPT_SUPPRESS_CONNECT_HEADERS: CURLoption = 265;
const CURLOPT_HEADEROPT: CURLoption = 229;
const CURLOPT_TCP_KEEPCNT: CURLoption = 326;
const CURLHEADER_SEPARATE: c_long = 1;
const TCP_KEEP_COUNT_UNSUPPORTED_ERROR: &str = "TCP keepalive probeCount requires libcurl 8.9.0 or newer and platform support";

#[derive(Default)]
struct HeaderList(*mut curl_slist);

impl HeaderList {
  fn append(&mut self, value: &str) -> Result<CURLcode> {
    let value = curl_header_string(value)?;
    let next = unsafe { curl_sys::curl_slist_append(self.0, value.as_ptr()) };
    if next.is_null() {
      return Ok(CURLE_OUT_OF_MEMORY);
    }
    self.0 = next;
    Ok(CURLE_OK)
  }
}

impl Drop for HeaderList {
  fn drop(&mut self) {
    if !self.0.is_null() {
      unsafe { curl_sys::curl_slist_free_all(self.0) };
    }
  }
}

pub(crate) struct ParsedRequestOptions {
  http_version: c_long,
  ip_resolve: c_long,
  tls_cert_type: Option<&'static str>,
  tls_version: Option<c_long>,
  http_auth: Option<c_long>,
  proxy_auth: Option<c_long>,
}

impl ParsedRequestOptions {
  pub(crate) fn parse(options: &NativeRequestOptions) -> Result<Self> {
    Ok(Self {
      http_version: parse_http_version(options.http_version.as_deref())?,
      ip_resolve: parse_ip_resolve(options.family)?,
      tls_cert_type: parse_tls_cert_type(options.tls_cert_type.as_deref())?,
      tls_version: parse_tls_version_range(options.tls_min_version.as_deref(), options.tls_max_version.as_deref())?,
      http_auth: parse_auth(options.auth_type.as_deref(), AuthTarget::Http)?,
      proxy_auth: parse_auth(options.proxy_auth.as_deref(), AuthTarget::Proxy)?,
    })
  }
}

// Header lists, MIME data, and string backing storage intentionally live until
// after the last curl operation, but are dropped before the easy handle.
pub(crate) struct RequestSetup {
  curl: *mut CURL,
  headers: HeaderList,
  proxy_headers: HeaderList,
  mime: Option<Mime>,
  keepalive: Vec<CString>,
  pub(crate) code: CURLcode,
  pub(crate) transport_error_override: Option<&'static str>,
}

impl RequestSetup {
  pub(crate) fn new(curl: *mut CURL) -> Self {
    Self {
      curl,
      headers: HeaderList::default(),
      proxy_headers: HeaderList::default(),
      mime: None,
      keepalive: Vec::new(),
      code: CURLE_OK,
      transport_error_override: None,
    }
  }

  pub(crate) fn configure(
    &mut self,
    options: &NativeRequestOptions,
    parsed: ParsedRequestOptions,
    state_pointer: *mut c_void,
    error_buffer: &mut [c_char],
  ) -> Result<()> {
    self.configure_base(options, &parsed, state_pointer, error_buffer);
    self.configure_callbacks(options, state_pointer);
    self.configure_security(options, parsed)?;
    self.configure_limits(options);
    self.configure_headers(options)?;
    self.configure_body(options.body.as_ref());
    self.configure_mime(options);
    Ok(())
  }

  fn configure_base(
    &mut self,
    options: &NativeRequestOptions,
    parsed: &ParsedRequestOptions,
    state_pointer: *mut c_void,
    error_buffer: &mut [c_char],
  ) {
    let curl = self.curl;
    let code = &mut self.code;
    let keepalive = &mut self.keepalive;
    let no_body = options.no_body.unwrap_or(false);
    let has_request_payload = options.body.is_some() || options.form.is_some();
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_ERRORBUFFER,
        error_buffer.as_mut_ptr(),
      )
    });
    keep_first_error(
      code,
      set_string_option(
        curl,
        curl_sys::CURLOPT_URL,
        Some(&options.url),
        keepalive,
        false,
      ),
    );
    // Do not let libcurl implicitly route requests through process-level
    // http_proxy/HTTPS_PROXY/ALL_PROXY variables. Proxying is an explicit
    // high-level feature and must not change request behaviour ambiently.
    keep_first_error(
      code,
      set_string_option(
        curl,
        curl_sys::CURLOPT_PROXY,
        Some(options.proxy.as_deref().unwrap_or("")),
        keepalive,
        true,
      ),
    );
    keep_first_error(
      code,
      set_string_option(
        curl,
        curl_sys::CURLOPT_CUSTOMREQUEST,
        Some(&options.method),
        keepalive,
        false,
      ),
    );
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HTTP_VERSION, parsed.http_version)
    });
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_IPRESOLVE, parsed.ip_resolve)
    });
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_CONNECTTIMEOUT_MS,
        options.connect_timeout.unwrap_or_default() as c_long,
      )
    });
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_TIMEOUT_MS,
        options.overall_timeout.unwrap_or_default() as c_long,
      )
    });
    keep_first_error(code, unsafe {
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
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_WRITEFUNCTION,
        write_callback as curl_sys::curl_write_callback,
      )
    });
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_WRITEDATA, state_pointer)
    });
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(
        curl,
        curl_sys::CURLOPT_HEADERFUNCTION,
        header_callback as curl_sys::curl_write_callback,
      )
    });
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HEADERDATA, state_pointer)
    });
  }

  fn configure_callbacks(&mut self, options: &NativeRequestOptions, state_pointer: *mut c_void) {
    let curl = self.curl;
    let code = &mut self.code;
    let track_internal_exchanges = options.body.is_some() || options.form.is_some()
      || needs_auth_response_tracking(options.auth_type.as_deref(), options.proxy_auth.as_deref());
    // Negotiated authentication and uploads can retry internally, including
    // unauthenticated Expect: 100-continue rejection retries. Only HEADER_OUT
    // proves a new exchange; wire header/trailer text must not forge one.
    // Ordinary bodyless requests do not need verbose callback traffic.
    if track_internal_exchanges {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(
          curl,
          curl_sys::CURLOPT_DEBUGFUNCTION,
          request_debug_callback as curl_sys::curl_debug_callback,
        )
      });
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_DEBUGDATA, state_pointer)
      });
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_VERBOSE, 1 as c_long)
      });
    }
    if options.socket_timeout.unwrap_or_default() > 0
      && (options.max_download_speed.unwrap_or_default() > 0
        || options.max_upload_speed.unwrap_or_default() > 0)
    {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(
          curl,
          CURLOPT_XFERINFOFUNCTION,
          transfer_progress_callback as CurlXferInfoCallback,
        )
      });
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_PROGRESSDATA, state_pointer)
      });
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_NOPROGRESS, 0 as c_long)
      });
    }
  }

  fn configure_security(
    &mut self,
    options: &NativeRequestOptions,
    parsed: ParsedRequestOptions,
  ) -> Result<()> {
    let curl = self.curl;
    let code = &mut self.code;
    let keepalive = &mut self.keepalive;
    let proxy_headers = &mut self.proxy_headers;
    let tls_cert_type = parsed.tls_cert_type;
    let tls_version = parsed.tls_version;
    let http_auth = parsed.http_auth;
    let proxy_auth = parsed.proxy_auth;
    if options.ca_file.is_none() {
      keep_first_error(code, configure_default_ca(curl, keepalive));
    } else {
      // An explicit bundle replaces default directory trust as well.
      let capath_code = unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_CAPATH, ptr::null::<c_char>())
      };
      // Backends without CA-directory support have no directory to clear.
      if capath_code != CURLE_NOT_BUILT_IN {
        keep_first_error(code, capath_code);
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
        code,
        set_string_option(curl, option, value, keepalive, true),
      );
    }
    if let Some(value) = tls_version {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_SSLVERSION, value)
      });
    }
    if let Some(value) = http_auth {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HTTPAUTH, value)
      });
    }
    if let Some(value) = proxy_auth {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_PROXYAUTH, value)
      });
    }
    for header in options.proxy_headers.as_deref().unwrap_or_default() {
      let next = proxy_headers.append(header)?;
      if next != CURLE_OK {
        *code = CURLE_OUT_OF_MEMORY;
        break;
      }
    }
    if !proxy_headers.0.is_null() {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(
          curl,
          CURLOPT_HEADEROPT,
          CURLHEADER_SEPARATE,
        )
      });
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_PROXYHEADER, proxy_headers.0)
      });
    }
    // CONNECT headers belong to the proxy, not the origin. In particular, they
    // must not trigger the HEAD-with-payload early-stop callback.
    keep_first_error(code, unsafe {
      curl_sys::curl_easy_setopt(curl, CURLOPT_SUPPRESS_CONNECT_HEADERS, 1 as c_long)
    });
    Ok(())
  }

  fn configure_limits(&mut self, options: &NativeRequestOptions) {
    let curl = self.curl;
    let code = &mut self.code;
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
    if let Some(value) = options.tcp_keep_count {
      let next = unsafe {
        curl_sys::curl_easy_setopt(curl, CURLOPT_TCP_KEEPCNT, value as c_long)
      };
      if *code == CURLE_OK
        && (next == curl_sys::CURLE_UNKNOWN_OPTION || next == CURLE_NOT_BUILT_IN)
      {
        self.transport_error_override = Some(TCP_KEEP_COUNT_UNSUPPORTED_ERROR);
      }
      keep_first_error(code, next);
    }
  }

  fn configure_headers(&mut self, options: &NativeRequestOptions) -> Result<()> {
    let curl = self.curl;
    let code = &mut self.code;
    let headers = &mut self.headers;
    let request_headers = options.headers.as_deref().unwrap_or_default();
    let has_form = options.form.is_some();
    let has_content_type = request_headers
      .iter()
      .any(|header| header_name_matches(header, "content-type"));
    let has_accept = request_headers
      .iter()
      .any(|header| header_name_matches(header, "accept"));
    let request_body = options.body.as_ref();
    for header in request_headers {
      let next = headers.append(header)?;
      if next != CURLE_OK {
        *code = CURLE_OUT_OF_MEMORY;
        break;
      }
    }
    // libcurl otherwise invents Accept: */*. Absence of Accept has distinct
    // HTTP semantics (no declared media-type preference), and Node does not add
    // this header, so suppress the transport default unless the caller supplied it.
    if *code == CURLE_OK && !has_accept {
      *code = headers.append("Accept:")?;
    }

    // CURLOPT_POSTFIELDS otherwise invents application/x-www-form-urlencoded.
    // A raw body has no implied media type, so suppress libcurl's generated
    // Content-Type unless the caller (or JSON preparation) supplied one.
    if *code == CURLE_OK && request_body.is_some() && !has_form && !has_content_type {
      *code = headers.append("Content-Type:")?;
    }
    if !headers.0.is_null() {
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_HTTPHEADER, headers.0)
      });
    }

    Ok(())
  }

  fn configure_body(
    &mut self,
    request_body: Option<&Either<String, napi::bindgen_prelude::Buffer>>,
  ) {
    let curl = self.curl;
    let code = &mut self.code;
    if let Some(body) = request_body {
      let body: &[u8] = match body {
        Either::A(text) => text.as_bytes(),
        Either::B(buffer) => buffer.as_ref(),
      };
      let body_pointer = if body.is_empty() {
        c"".as_ptr()
      } else {
        body.as_ptr().cast::<c_char>()
      };
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(
          curl,
          curl_sys::CURLOPT_POSTFIELDSIZE_LARGE,
          body.len() as curl_off_t,
        )
      });
      keep_first_error(code, unsafe {
        curl_sys::curl_easy_setopt(curl, curl_sys::CURLOPT_POSTFIELDS, body_pointer)
      });
    }
  }

  fn configure_mime(&mut self, options: &NativeRequestOptions) {
    let curl = self.curl;
    let code = &mut self.code;
    let keepalive = &mut self.keepalive;
    let has_form = options.form.is_some();
    let form = options.form.as_deref().unwrap_or_default();
    if *code == CURLE_OK && has_form {
      match build_mime(curl, form, keepalive) {
        Ok(next_mime) => self.mime = Some(next_mime),
        Err(next_code) => *code = next_code,
      }
    }
  }
}
