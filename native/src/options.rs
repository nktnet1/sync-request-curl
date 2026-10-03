use std::os::raw::c_long;

use napi::{Error, Result};

use crate::types::NativeRequestOptions;

const CURLAUTH_BEARER: c_long = 1 << 6;
const CURL_HTTP_VERSION_3ONLY: c_long = 31;
const CURL_SSLVERSION_MAX_SHIFT: u32 = 16;

pub(crate) fn header_name_matches(header: &str, expected_name: &str) -> bool {
  let delimiter_index = header
    .find(|character| character == ':' || character == ';')
    .unwrap_or(header.len());
  header[..delimiter_index]
    .trim()
    .eq_ignore_ascii_case(expected_name)
}

pub(crate) fn parse_http_version(version: Option<&str>) -> Result<c_long> {
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
pub(crate) fn parse_ip_resolve(family: Option<i64>) -> Result<c_long> {
  match family.unwrap_or(0) {
    0 => Ok(curl_sys::CURL_IPRESOLVE_WHATEVER as c_long),
    4 => Ok(curl_sys::CURL_IPRESOLVE_V4 as c_long),
    6 => Ok(curl_sys::CURL_IPRESOLVE_V6 as c_long),
    value => Err(Error::from_reason(format!(
      "Unsupported IP address family: {value}"
    ))),
  }
}

pub(crate) fn parse_tls_cert_type(cert_type: Option<&str>) -> Result<Option<&'static str>> {
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

pub(crate) fn parse_tls_version_range(
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
pub(crate) enum AuthTarget {
  Http,
  Proxy,
}

pub(crate) fn parse_auth(auth: Option<&str>, target: AuthTarget) -> Result<Option<c_long>> {
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

pub(crate) fn validate_auth_credentials(options: &NativeRequestOptions) -> Result<()> {
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

pub(crate) fn validate_proxy_headers(
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

pub(crate) fn uses_negotiated_auth(auth: Option<&str>) -> bool {
  matches!(auth, Some("any" | "digest" | "ntlm" | "negotiate"))
}

pub(crate) fn needs_auth_response_tracking(auth: Option<&str>, proxy_auth: Option<&str>) -> bool {
  uses_negotiated_auth(auth) || uses_negotiated_auth(proxy_auth)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn native_credentials_enforce_header_safe_syntax() {
    for control in ['\0', '\r', '\n', '\t', '\x1f', '\x7f'] {
      assert!(!safe_auth_username(&format!("user{control}"), None));
      assert!(!safe_bearer_token(&format!("token{control}")));
    }
    for token in ["", "=", "token space", "to=ken", "token=\n"] {
      assert!(!safe_bearer_token(token));
    }
    assert!(safe_auth_username("", None));
    assert!(safe_auth_username("caf\u{e9}", None));
    assert!(safe_bearer_token("a.b_c-~+/=="));
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
  fn authentication_timeout_tracking_is_limited_to_negotiated_authentication() {
    for auth in [Some("any"), Some("digest"), Some("ntlm"), Some("negotiate")] {
      assert!(needs_auth_response_tracking(auth, None));
      assert!(needs_auth_response_tracking(None, auth));
    }
    for auth in [None, Some("basic"), Some("bearer")] {
      assert!(!needs_auth_response_tracking(auth, None));
      assert!(!needs_auth_response_tracking(None, auth));
    }
  }
}
