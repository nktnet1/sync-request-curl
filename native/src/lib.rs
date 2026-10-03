use napi::Result;
use napi_derive::napi;

mod callbacks;
mod connection_pool;
mod curl_utils;
mod mime;
mod multi;
mod options;
mod rate_limit;
mod request;
mod response_tracking;
mod types;

pub use types::{NativeFormDataEntry, NativeRequestOptions, NativeResponse};

#[napi(js_name = "createConnectionPool")]
pub fn create_connection_pool(max_connections: i64) -> Result<i64> {
  connection_pool::create_connection_pool(max_connections)
}

#[napi(js_name = "releaseConnectionPool")]
pub fn release_connection_pool(pool_id: i64) {
  connection_pool::release_connection_pool(pool_id);
}

#[napi]
pub fn request(options: NativeRequestOptions) -> Result<NativeResponse> {
  request::request(options)
}
