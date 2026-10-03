use napi::bindgen_prelude::{Buffer, Either};
use napi_derive::napi;

#[napi(object, object_to_js = false)]
pub struct NativeFormDataEntry {
  pub key: String,
  pub value: Either<String, Buffer>,
  #[napi(js_name = "fileName")]
  pub file_name: Option<String>,
  #[napi(js_name = "contentType")]
  pub content_type: Option<String>,
}

#[napi(object, object_to_js = false)]
pub struct NativeRequestOptions {
  pub method: String,
  pub url: String,
  pub headers: Option<Vec<String>>,
  pub body: Option<Either<String, Buffer>>,
  pub form: Option<Vec<NativeFormDataEntry>>,
  #[napi(js_name = "httpVersion")]
  pub http_version: Option<String>,
  pub family: Option<i64>,
  pub timeout: Option<i64>,
  #[napi(js_name = "connectTimeout")]
  pub connect_timeout: Option<i64>,
  #[napi(js_name = "overallTimeout")]
  pub overall_timeout: Option<i64>,
  #[napi(js_name = "authType")]
  pub auth_type: Option<String>,
  #[napi(js_name = "authUsername")]
  pub auth_username: Option<String>,
  #[napi(js_name = "authPassword")]
  pub auth_password: Option<String>,
  #[napi(js_name = "authBearer")]
  pub auth_bearer: Option<String>,
  pub proxy: Option<String>,
  #[napi(js_name = "proxyUsername")]
  pub proxy_username: Option<String>,
  #[napi(js_name = "proxyPassword")]
  pub proxy_password: Option<String>,
  #[napi(js_name = "proxyAuth")]
  pub proxy_auth: Option<String>,
  #[napi(js_name = "proxyNoProxy")]
  pub proxy_no_proxy: Option<String>,
  #[napi(js_name = "proxyHeaders")]
  pub proxy_headers: Option<Vec<String>>,
  #[napi(js_name = "rejectUnauthorized")]
  pub reject_unauthorized: Option<bool>,
  #[napi(js_name = "caFile")]
  pub ca_file: Option<String>,
  #[napi(js_name = "tlsCertFile")]
  pub tls_cert_file: Option<String>,
  #[napi(js_name = "tlsCertType")]
  pub tls_cert_type: Option<String>,
  #[napi(js_name = "tlsKeyFile")]
  pub tls_key_file: Option<String>,
  #[napi(js_name = "tlsKeyPassphrase")]
  pub tls_key_passphrase: Option<String>,
  #[napi(js_name = "tlsMinVersion")]
  pub tls_min_version: Option<String>,
  #[napi(js_name = "tlsMaxVersion")]
  pub tls_max_version: Option<String>,
  #[napi(js_name = "networkInterface")]
  pub network_interface: Option<String>,
  #[napi(js_name = "localPort")]
  pub local_port: Option<i64>,
  #[napi(js_name = "localPortRange")]
  pub local_port_range: Option<i64>,
  #[napi(js_name = "maxDownloadSpeed")]
  pub max_download_speed: Option<i64>,
  #[napi(js_name = "maxUploadSpeed")]
  pub max_upload_speed: Option<i64>,
  #[napi(js_name = "tcpKeepAlive")]
  pub tcp_keep_alive: Option<bool>,
  #[napi(js_name = "tcpKeepIdle")]
  pub tcp_keep_idle: Option<i64>,
  #[napi(js_name = "tcpKeepInterval")]
  pub tcp_keep_interval: Option<i64>,
  #[napi(js_name = "tcpKeepCount")]
  pub tcp_keep_count: Option<i64>,
  #[napi(js_name = "socketTimeout")]
  pub socket_timeout: Option<i64>,
  #[napi(js_name = "maxResponseHeaderSize")]
  pub max_response_header_size: Option<i64>,
  #[napi(js_name = "noBody")]
  pub no_body: Option<bool>,
  #[napi(js_name = "stopOnRedirectHeaders")]
  pub stop_on_redirect_headers: Option<bool>,
  #[napi(js_name = "connectionPoolId")]
  pub connection_pool_id: Option<i64>,
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
  #[napi(js_name = "requestHeaderOffsets")]
  pub request_header_offsets: Vec<i64>,
  pub body: Buffer,
}
