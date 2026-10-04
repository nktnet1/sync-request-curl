use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_long, c_void};
use std::ptr;
use std::time::Instant;

use curl_sys::{curl_off_t, curl_slist, CURLcode, CURLoption, CURL, CURLE_OK, CURLE_OPERATION_TIMEDOUT, CURLE_OUT_OF_MEMORY, CURLE_WRITE_ERROR, CURLOPTTYPE_OBJECTPOINT};
use napi::bindgen_prelude::Either;
use napi::{Error, Result};

use crate::callbacks::{header_callback, request_debug_callback, transfer_progress_callback, write_callback, CurlXferInfoCallback, RequestState, DEFAULT_MAX_RESPONSE_HEADER_SIZE, CURLOPT_XFERINFOFUNCTION};
use crate::curl_utils::{configure_default_ca, curl_header_string, ensure_curl_initialized, keep_first_error, set_string_option, transport_error_message, EasyHandle, CURLE_NOT_BUILT_IN};
use crate::mime::{build_mime, Mime};
use crate::multi::perform_request;
use crate::options::{header_name_matches, needs_auth_response_tracking, parse_auth, parse_http_version, parse_ip_resolve, parse_tls_cert_type, parse_tls_version_range, proxy_url_has_credentials, uses_negotiated_auth, validate_auth_credentials, validate_proxy_headers, AuthTarget};
use crate::rate_limit::RateLimitAllowance;
use crate::types::{NativeRequestOptions, NativeResponse};

const RESPONSE_HEADER_OVERFLOW_ERROR: &str = "Response headers exceeded the configured size limit";
const RESPONSE_TRACKING_UNAVAILABLE_ERROR: &str = "Response header timeouts with negotiated authentication require libcurl verbose strings; use the bundled libcurl build";
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

pub(crate) fn request(options: NativeRequestOptions) -> Result<NativeResponse> {
  validate_auth_credentials(&options)?;
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
  ensure_curl_initialized()?;

  // Keep the original Node Buffer alive for the whole synchronous transfer.
  // napi::Buffer is zero-copy; converting it to Vec<u8> would duplicate large uploads.
  let request_body = options.body;
  let has_form = options.form.is_some();
  let has_request_payload = request_body.is_some() || has_form;
  let track_internal_exchanges = has_request_payload
    || needs_auth_response_tracking(
      options.auth_type.as_deref(),
      options.proxy_auth.as_deref(),
    );
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
  // Preserve explicit single-exchange metadata without a debug callback.
  // HEADER_OUT deduplicates this initial offset when tracing is enabled.
  state.request_header_offsets.push(0);
  let easy = EasyHandle::new()?;
  let curl = easy.0;
  state.easy_handle = curl;
  state.requires_debug_text = options.timeout.unwrap_or_default() > 0
    && needs_auth_response_tracking(
      options.auth_type.as_deref(),
      options.proxy_auth.as_deref(),
    );
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
  // Negotiated authentication and uploads can retry internally, including
  // unauthenticated Expect: 100-continue rejection retries. Only HEADER_OUT
  // proves a new exchange; wire header/trailer text must not forge one.
  // Ordinary bodyless requests do not need verbose callback traffic.
  if track_internal_exchanges {
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
    let next = proxy_headers.append(&header)?;
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
    let next = headers.append(&header)?;
    if next != CURLE_OK {
      code = CURLE_OUT_OF_MEMORY;
      break;
    }
  }
  // libcurl otherwise invents Accept: */*. Absence of Accept has distinct
  // HTTP semantics (no declared media-type preference), and Node does not add
  // this header, so suppress the transport default unless the caller supplied it.
  if code == CURLE_OK && !has_accept {
    code = headers.append("Accept:")?;
  }

  // CURLOPT_POSTFIELDS otherwise invents application/x-www-form-urlencoded.
  // A raw body has no implied media type, so suppress libcurl's generated
  // Content-Type unless the caller (or JSON preparation) supplied one.
  if code == CURLE_OK && request_body.is_some() && !has_form && !has_content_type {
    code = headers.append("Content-Type:")?;
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
