// libcurl has no public getinfo for its pending authentication retry. Its
// informational notification is emitted when it decides to drain an ignored
// response, before that body completes (http_firstwrite in lib/http.c). Do not
// infer the decision from 401/407: those can also be terminal rejections.
const IGNORED_RESPONSE_BODY: &[u8] = b"Ignoring the response-body";

pub fn ignores_response_body(message: &[u8]) -> bool {
  let mut message = message.trim_ascii();
  // curl_global_trace can prepend transfer IDs and component names. Consume
  // only bracketed prefixes, not arbitrary substrings of informational text.
  while let Some(prefixed) = message.strip_prefix(b"[") {
    let Some(end) = prefixed.iter().position(|byte| *byte == b']') else {
      return false;
    };
    message = prefixed[end + 1..].trim_ascii_start();
  }
  message == IGNORED_RESPONSE_BODY
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn recognizes_only_the_libcurl_retry_notification() {
    for message in [
      "Ignoring the response-body\n",
      "[0-1] Ignoring the response-body\n",
      "[0-1] [HTTP] Ignoring the response-body\r\n",
    ] {
      assert!(ignores_response_body(message.as_bytes()));
    }
    for message in [
      "",
      "[unterminated Ignoring the response-body",
      "X-Note: Ignoring the response-body\r\n",
      "Ignoring the response-body extra",
    ] {
      assert!(!ignores_response_body(message.as_bytes()));
    }
  }
}
