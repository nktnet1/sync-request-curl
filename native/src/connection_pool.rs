use std::collections::HashMap;
use std::ffi::CStr;
use std::os::raw::c_long;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use curl_sys::{CURLcode, CURLMcode, CURLM, CURLE_OUT_OF_MEMORY, CURLM_OK};
use napi::{Error, Result};

use crate::curl_utils::{curl_error_message, ensure_curl_initialized};

static CONNECTION_POOLS: OnceLock<Mutex<HashMap<i64, Arc<Mutex<MultiHandle>>>>> = OnceLock::new();
static NEXT_CONNECTION_POOL_ID: AtomicI64 = AtomicI64::new(1);

pub(crate) struct MultiHandle(pub(crate) *mut CURLM);

// A pool is never used concurrently: every transfer locks its MultiHandle.
// libcurl permits moving handles between threads as long as only one thread
// uses a handle at a time.
unsafe impl Send for MultiHandle {}

impl MultiHandle {
  pub(crate) fn new() -> std::result::Result<Self, CURLcode> {
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

pub(crate) fn create_connection_pool(max_connections: i64) -> Result<i64> {
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

pub(crate) fn release_connection_pool(pool_id: i64) {
  if let Ok(mut pools) = connection_pools().lock() {
    pools.remove(&pool_id);
  }
}

pub(crate) fn get_connection_pool(pool_id: i64) -> Option<Arc<Mutex<MultiHandle>>> {
  connection_pools().lock().ok()?.get(&pool_id).cloned()
}
