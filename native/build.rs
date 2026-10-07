use std::env;

fn main() {
  let bundled = env::var_os("CARGO_FEATURE_BUNDLED_CURL").is_some()
    || env::var_os("CARGO_FEATURE_BUNDLED_CURL_HTTP3").is_some();
  let system = env::var_os("CARGO_FEATURE_SYSTEM_CURL").is_some();

  match (bundled, system) {
    (true, false) => {}
    (false, true) => {
      if env::var_os("DEP_CURL_STATIC").is_some() {
        panic!(
          "system-curl was requested, but curl-sys could not find a system libcurl and fell back to its bundled copy; install a discoverable system libcurl or build with bundled-curl"
        );
      }
    }
    (false, false) => {
      panic!(
        "select exactly one libcurl source feature: bundled-curl, bundled-curl-http3, or system-curl"
      );
    }
    (true, true) => {
      panic!("bundled libcurl features and system-curl are mutually exclusive");
    }
  }

  napi_build::setup();
}
