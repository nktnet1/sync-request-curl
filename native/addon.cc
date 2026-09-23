#include <node_api.h>

#include <curl/curl.h>

#include <algorithm>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace {

struct RequestState {
  std::vector<unsigned char> body;
  std::vector<std::string> headers;
};

bool CheckNapi(napi_env env, napi_status status, const char* message) {
  if (status == napi_ok) {
    return true;
  }
  napi_throw_error(env, nullptr, message);
  return false;
}

bool GetNamedValue(
    napi_env env,
    napi_value object,
    const char* name,
    napi_value* value,
    bool* found = nullptr) {
  bool has_property = false;
  if (!CheckNapi(
          env,
          napi_has_named_property(env, object, name, &has_property),
          "Failed to inspect native request option")) {
    return false;
  }
  if (found != nullptr) {
    *found = has_property;
  }
  if (!has_property) {
    return true;
  }
  return CheckNapi(
      env,
      napi_get_named_property(env, object, name, value),
      "Failed to read native request option");
}

bool GetString(
    napi_env env,
    napi_value value,
    std::string* output,
    const char* message) {
  napi_valuetype type;
  if (!CheckNapi(env, napi_typeof(env, value, &type), message)) {
    return false;
  }
  if (type != napi_string) {
    napi_throw_type_error(env, nullptr, message);
    return false;
  }

  size_t length = 0;
  if (!CheckNapi(
          env,
          napi_get_value_string_utf8(env, value, nullptr, 0, &length),
          message)) {
    return false;
  }

  output->resize(length + 1);
  size_t written = 0;
  if (!CheckNapi(
          env,
          napi_get_value_string_utf8(
              env,
              value,
              output->data(),
              length + 1,
              &written),
          message)) {
    return false;
  }
  output->resize(written);
  return true;
}

bool GetNamedString(
    napi_env env,
    napi_value object,
    const char* name,
    std::string* output,
    bool required = false) {
  napi_value value;
  bool found = false;
  if (!GetNamedValue(env, object, name, &value, &found)) {
    return false;
  }
  if (!found) {
    if (required) {
      std::string message = "Missing native request option: ";
      message += name;
      napi_throw_type_error(env, nullptr, message.c_str());
      return false;
    }
    return true;
  }
  std::string message = "Native request option must be a string: ";
  message += name;
  return GetString(env, value, output, message.c_str());
}

bool GetNamedBool(
    napi_env env,
    napi_value object,
    const char* name,
    bool* output,
    bool default_value) {
  napi_value value;
  bool found = false;
  if (!GetNamedValue(env, object, name, &value, &found)) {
    return false;
  }
  if (!found) {
    *output = default_value;
    return true;
  }

  napi_valuetype type;
  if (!CheckNapi(
          env,
          napi_typeof(env, value, &type),
          "Failed to inspect boolean native request option")) {
    return false;
  }
  if (type != napi_boolean) {
    napi_throw_type_error(env, nullptr, "Native request option must be boolean");
    return false;
  }
  return CheckNapi(
      env,
      napi_get_value_bool(env, value, output),
      "Failed to read boolean native request option");
}

bool GetNamedInt64(
    napi_env env,
    napi_value object,
    const char* name,
    int64_t* output,
    int64_t default_value) {
  napi_value value;
  bool found = false;
  if (!GetNamedValue(env, object, name, &value, &found)) {
    return false;
  }
  if (!found) {
    *output = default_value;
    return true;
  }

  napi_valuetype type;
  if (!CheckNapi(
          env,
          napi_typeof(env, value, &type),
          "Failed to inspect numeric native request option")) {
    return false;
  }
  if (type != napi_number) {
    napi_throw_type_error(env, nullptr, "Native request option must be a number");
    return false;
  }
  return CheckNapi(
      env,
      napi_get_value_int64(env, value, output),
      "Failed to read numeric native request option");
}

size_t WriteCallback(char* ptr, size_t size, size_t nmemb, void* userdata) {
  const size_t bytes = size * nmemb;
  auto* state = static_cast<RequestState*>(userdata);
  try {
    const auto* begin = reinterpret_cast<unsigned char*>(ptr);
    state->body.insert(state->body.end(), begin, begin + bytes);
    return bytes;
  } catch (...) {
    return 0;
  }
}

std::string TrimHeaderLine(const char* ptr, size_t bytes) {
  size_t begin = 0;
  size_t end = bytes;
  while (begin < end &&
         (ptr[begin] == ' ' || ptr[begin] == '\t' || ptr[begin] == '\r' ||
          ptr[begin] == '\n')) {
    ++begin;
  }
  while (end > begin &&
         (ptr[end - 1] == ' ' || ptr[end - 1] == '\t' ||
          ptr[end - 1] == '\r' || ptr[end - 1] == '\n')) {
    --end;
  }
  return std::string(ptr + begin, end - begin);
}

size_t HeaderCallback(char* ptr, size_t size, size_t nmemb, void* userdata) {
  const size_t bytes = size * nmemb;
  auto* state = static_cast<RequestState*>(userdata);
  try {
    state->headers.push_back(TrimHeaderLine(ptr, bytes));
    return bytes;
  } catch (...) {
    return 0;
  }
}

bool ReadStringArray(
    napi_env env,
    napi_value value,
    std::vector<std::string>* output,
    const char* message) {
  bool is_array = false;
  if (!CheckNapi(env, napi_is_array(env, value, &is_array), message)) {
    return false;
  }
  if (!is_array) {
    napi_throw_type_error(env, nullptr, message);
    return false;
  }

  uint32_t length = 0;
  if (!CheckNapi(env, napi_get_array_length(env, value, &length), message)) {
    return false;
  }
  output->reserve(length);
  for (uint32_t index = 0; index < length; ++index) {
    napi_value item;
    if (!CheckNapi(env, napi_get_element(env, value, index, &item), message)) {
      return false;
    }
    std::string text;
    if (!GetString(env, item, &text, message)) {
      return false;
    }
    output->push_back(std::move(text));
  }
  return true;
}

bool ReadBody(
    napi_env env,
    napi_value options,
    std::vector<unsigned char>* body,
    bool* has_body) {
  napi_value value;
  bool found = false;
  if (!GetNamedValue(env, options, "body", &value, &found)) {
    return false;
  }
  if (!found) {
    *has_body = false;
    return true;
  }

  bool is_buffer = false;
  if (!CheckNapi(
          env,
          napi_is_buffer(env, value, &is_buffer),
          "Failed to inspect request body")) {
    return false;
  }
  if (is_buffer) {
    void* data = nullptr;
    size_t length = 0;
    if (!CheckNapi(
            env,
            napi_get_buffer_info(env, value, &data, &length),
            "Failed to read request body buffer")) {
      return false;
    }
    const auto* begin = static_cast<unsigned char*>(data);
    body->assign(begin, begin + length);
    *has_body = true;
    return true;
  }

  napi_valuetype type;
  if (!CheckNapi(
          env,
          napi_typeof(env, value, &type),
          "Failed to inspect request body")) {
    return false;
  }
  if (type != napi_string) {
    napi_throw_type_error(env, nullptr, "Native request body must be a string or Buffer");
    return false;
  }

  std::string text;
  if (!GetString(env, value, &text, "Failed to read request body string")) {
    return false;
  }
  body->assign(text.begin(), text.end());
  *has_body = true;
  return true;
}

CURLcode ApplyStringOption(
    CURL* curl,
    CURLoption option,
    const std::string& value) {
  if (value.empty()) {
    return CURLE_OK;
  }
  return curl_easy_setopt(curl, option, value.c_str());
}

CURLcode BuildMime(
    napi_env env,
    CURL* curl,
    napi_value options,
    curl_mime** output_mime) {
  napi_value form_data;
  bool found = false;
  if (!GetNamedValue(env, options, "formData", &form_data, &found)) {
    return CURLE_FAILED_INIT;
  }
  if (!found) {
    return CURLE_OK;
  }

  bool is_array = false;
  if (!CheckNapi(
          env,
          napi_is_array(env, form_data, &is_array),
          "formData must be an array")) {
    return CURLE_FAILED_INIT;
  }
  if (!is_array) {
    napi_throw_type_error(env, nullptr, "formData must be an array");
    return CURLE_FAILED_INIT;
  }

  curl_mime* mime = curl_mime_init(curl);
  if (mime == nullptr) {
    return CURLE_OUT_OF_MEMORY;
  }

  uint32_t length = 0;
  if (!CheckNapi(
          env,
          napi_get_array_length(env, form_data, &length),
          "Failed to read formData")) {
    curl_mime_free(mime);
    return CURLE_FAILED_INIT;
  }

  for (uint32_t index = 0; index < length; ++index) {
    napi_value field;
    if (!CheckNapi(
            env,
            napi_get_element(env, form_data, index, &field),
            "Failed to read formData field")) {
      curl_mime_free(mime);
      return CURLE_FAILED_INIT;
    }

    std::string name;
    if (!GetNamedString(env, field, "name", &name, true)) {
      curl_mime_free(mime);
      return CURLE_FAILED_INIT;
    }

    curl_mimepart* part = curl_mime_addpart(mime);
    if (part == nullptr) {
      curl_mime_free(mime);
      return CURLE_OUT_OF_MEMORY;
    }

    CURLcode code = curl_mime_name(part, name.c_str());
    if (code != CURLE_OK) {
      curl_mime_free(mime);
      return code;
    }

    napi_value file_value;
    bool has_file = false;
    if (!GetNamedValue(env, field, "file", &file_value, &has_file)) {
      curl_mime_free(mime);
      return CURLE_FAILED_INIT;
    }

    if (has_file) {
      std::string file;
      if (!GetString(env, file_value, &file, "formData.file must be a string")) {
        curl_mime_free(mime);
        return CURLE_FAILED_INIT;
      }
      code = curl_mime_filedata(part, file.c_str());
      if (code != CURLE_OK) {
        curl_mime_free(mime);
        return code;
      }

      std::string type;
      if (!GetNamedString(env, field, "type", &type)) {
        curl_mime_free(mime);
        return CURLE_FAILED_INIT;
      }
      if (!type.empty()) {
        code = curl_mime_type(part, type.c_str());
        if (code != CURLE_OK) {
          curl_mime_free(mime);
          return code;
        }
      }

      std::string filename;
      if (!GetNamedString(env, field, "filename", &filename)) {
        curl_mime_free(mime);
        return CURLE_FAILED_INIT;
      }
      if (!filename.empty()) {
        code = curl_mime_filename(part, filename.c_str());
        if (code != CURLE_OK) {
          curl_mime_free(mime);
          return code;
        }
      }
      continue;
    }

    std::string contents;
    if (!GetNamedString(env, field, "contents", &contents, true)) {
      curl_mime_free(mime);
      return CURLE_FAILED_INIT;
    }
    code = curl_mime_data(part, contents.data(), contents.size());
    if (code != CURLE_OK) {
      curl_mime_free(mime);
      return code;
    }
  }

  const CURLcode code = curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);
  if (code != CURLE_OK) {
    curl_mime_free(mime);
    return code;
  }

  *output_mime = mime;
  return CURLE_OK;
}

bool SetNamedString(
    napi_env env,
    napi_value object,
    const char* name,
    const std::string& value) {
  napi_value js_value;
  return CheckNapi(
             env,
             napi_create_string_utf8(
                 env, value.data(), value.size(), &js_value),
             "Failed to create native response string") &&
         CheckNapi(
             env,
             napi_set_named_property(env, object, name, js_value),
             "Failed to set native response string");
}

bool SetNamedInt64(
    napi_env env,
    napi_value object,
    const char* name,
    int64_t value) {
  napi_value js_value;
  return CheckNapi(
             env,
             napi_create_int64(env, value, &js_value),
             "Failed to create native response number") &&
         CheckNapi(
             env,
             napi_set_named_property(env, object, name, js_value),
             "Failed to set native response number");
}

bool SetNamedNullableString(
    napi_env env,
    napi_value object,
    const char* name,
    const char* value) {
  napi_value js_value;
  if (value == nullptr) {
    if (!CheckNapi(
            env,
            napi_get_null(env, &js_value),
            "Failed to create native null value")) {
      return false;
    }
  } else if (!CheckNapi(
                 env,
                 napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &js_value),
                 "Failed to create native response string")) {
    return false;
  }
  return CheckNapi(
      env,
      napi_set_named_property(env, object, name, js_value),
      "Failed to set native response value");
}

napi_value Request(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (!CheckNapi(
          env,
          napi_get_cb_info(env, info, &argc, args, nullptr, nullptr),
          "Failed to read native request arguments")) {
    return nullptr;
  }
  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "native.request expects one options object");
    return nullptr;
  }

  napi_valuetype options_type;
  if (!CheckNapi(
          env,
          napi_typeof(env, args[0], &options_type),
          "Failed to inspect native request options")) {
    return nullptr;
  }
  if (options_type != napi_object) {
    napi_throw_type_error(env, nullptr, "native.request expects an options object");
    return nullptr;
  }

  std::string method;
  std::string url;
  if (!GetNamedString(env, args[0], "method", &method, true) ||
      !GetNamedString(env, args[0], "url", &url, true)) {
    return nullptr;
  }

  int64_t timeout_ms = 0;
  bool insecure = false;
  bool no_body = false;
  if (!GetNamedInt64(env, args[0], "timeout", &timeout_ms, 0) ||
      !GetNamedBool(env, args[0], "insecure", &insecure, false) ||
      !GetNamedBool(env, args[0], "noBody", &no_body, false)) {
    return nullptr;
  }

  napi_value headers_value;
  bool has_headers = false;
  if (!GetNamedValue(env, args[0], "headers", &headers_value, &has_headers)) {
    return nullptr;
  }
  std::vector<std::string> request_headers;
  if (has_headers &&
      !ReadStringArray(
          env,
          headers_value,
          &request_headers,
          "Native request headers must be an array of strings")) {
    return nullptr;
  }

  std::vector<unsigned char> request_body;
  bool has_body = false;
  if (!ReadBody(env, args[0], &request_body, &has_body)) {
    return nullptr;
  }

  napi_value curl_options;
  bool has_curl_options = false;
  if (!GetNamedValue(
          env, args[0], "curlOptions", &curl_options, &has_curl_options)) {
    return nullptr;
  }

  std::string proxy;
  std::string proxy_user_pwd;
  std::string user_agent;
  std::string referer;
  std::string ca_info;
  std::string interface_name;
  std::string dns_servers;
  bool tcp_keep_alive = false;
  if (has_curl_options) {
    if (!GetNamedString(env, curl_options, "proxy", &proxy) ||
        !GetNamedString(
            env, curl_options, "proxyUserPwd", &proxy_user_pwd) ||
        !GetNamedString(env, curl_options, "userAgent", &user_agent) ||
        !GetNamedString(env, curl_options, "referer", &referer) ||
        !GetNamedString(env, curl_options, "caInfo", &ca_info) ||
        !GetNamedString(env, curl_options, "interface", &interface_name) ||
        !GetNamedString(env, curl_options, "dnsServers", &dns_servers) ||
        !GetNamedBool(
            env,
            curl_options,
            "tcpKeepAlive",
            &tcp_keep_alive,
            false)) {
      return nullptr;
    }
  }

  CURL* curl = curl_easy_init();
  if (curl == nullptr) {
    napi_throw_error(env, nullptr, "curl_easy_init failed");
    return nullptr;
  }

  RequestState state;
  curl_slist* header_list = nullptr;
  curl_mime* mime = nullptr;
  CURLcode code = CURLE_OK;

  const auto set_option = [&code](CURLcode next_code) {
    if (code == CURLE_OK && next_code != CURLE_OK) {
      code = next_code;
    }
  };

  set_option(curl_easy_setopt(curl, CURLOPT_URL, url.c_str()));
  set_option(curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str()));
  set_option(curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(timeout_ms)));
  set_option(curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, insecure ? 0L : 1L));
  set_option(curl_easy_setopt(curl, CURLOPT_NOBODY, no_body ? 1L : 0L));
  set_option(curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback));
  set_option(curl_easy_setopt(curl, CURLOPT_WRITEDATA, &state));
  set_option(curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, HeaderCallback));
  set_option(curl_easy_setopt(curl, CURLOPT_HEADERDATA, &state));

  for (const std::string& header : request_headers) {
    curl_slist* next = curl_slist_append(header_list, header.c_str());
    if (next == nullptr) {
      code = CURLE_OUT_OF_MEMORY;
      break;
    }
    header_list = next;
  }
  if (header_list != nullptr) {
    set_option(curl_easy_setopt(curl, CURLOPT_HTTPHEADER, header_list));
  }

  if (has_body) {
    const char* body_ptr = request_body.empty()
                               ? ""
                               : reinterpret_cast<const char*>(request_body.data());
    set_option(curl_easy_setopt(
        curl,
        CURLOPT_POSTFIELDSIZE_LARGE,
        static_cast<curl_off_t>(request_body.size())));
    set_option(curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body_ptr));
  }

  if (code == CURLE_OK) {
    code = BuildMime(env, curl, args[0], &mime);
    bool exception_pending = false;
    napi_is_exception_pending(env, &exception_pending);
    if (exception_pending) {
      if (mime != nullptr) {
        curl_mime_free(mime);
      }
      if (header_list != nullptr) {
        curl_slist_free_all(header_list);
      }
      curl_easy_cleanup(curl);
      return nullptr;
    }
  }

  if (code == CURLE_OK) {
    set_option(ApplyStringOption(curl, CURLOPT_PROXY, proxy));
    set_option(ApplyStringOption(curl, CURLOPT_PROXYUSERPWD, proxy_user_pwd));
    set_option(ApplyStringOption(curl, CURLOPT_USERAGENT, user_agent));
    set_option(ApplyStringOption(curl, CURLOPT_REFERER, referer));
    set_option(ApplyStringOption(curl, CURLOPT_CAINFO, ca_info));
    set_option(ApplyStringOption(curl, CURLOPT_INTERFACE, interface_name));
#if LIBCURL_VERSION_NUM >= 0x071800
    set_option(ApplyStringOption(curl, CURLOPT_DNS_SERVERS, dns_servers));
#else
    if (!dns_servers.empty()) {
      code = CURLE_UNKNOWN_OPTION;
    }
#endif
    if (tcp_keep_alive) {
      set_option(curl_easy_setopt(curl, CURLOPT_TCP_KEEPALIVE, 1L));
    }
  }

  if (code == CURLE_OK) {
    code = curl_easy_perform(curl);
  }

  long status_code = 0;
  char* effective_url = nullptr;
  char* redirect_url = nullptr;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status_code);
  curl_easy_getinfo(curl, CURLINFO_EFFECTIVE_URL, &effective_url);
  curl_easy_getinfo(curl, CURLINFO_REDIRECT_URL, &redirect_url);

  napi_value result;
  if (!CheckNapi(
          env,
          napi_create_object(env, &result),
          "Failed to create native response")) {
    result = nullptr;
  }

  if (result != nullptr &&
      (!SetNamedInt64(env, result, "code", static_cast<int64_t>(code)) ||
       !SetNamedInt64(env, result, "statusCode", status_code) ||
       !SetNamedString(env, result, "errorMessage", curl_easy_strerror(code)) ||
       !SetNamedNullableString(env, result, "effectiveUrl", effective_url) ||
       !SetNamedNullableString(env, result, "redirectUrl", redirect_url))) {
    result = nullptr;
  }

  if (result != nullptr) {
    napi_value headers;
    if (!CheckNapi(
            env,
            napi_create_array_with_length(env, state.headers.size(), &headers),
            "Failed to create native response headers")) {
      result = nullptr;
    } else {
      for (size_t index = 0; index < state.headers.size(); ++index) {
        napi_value header;
        if (!CheckNapi(
                env,
                napi_create_string_utf8(
                    env,
                    state.headers[index].data(),
                    state.headers[index].size(),
                    &header),
                "Failed to create native response header") ||
            !CheckNapi(
                env,
                napi_set_element(
                    env, headers, static_cast<uint32_t>(index), header),
                "Failed to set native response header")) {
          result = nullptr;
          break;
        }
      }
      if (result != nullptr &&
          !CheckNapi(
              env,
              napi_set_named_property(env, result, "headers", headers),
              "Failed to set native response headers")) {
        result = nullptr;
      }
    }
  }

  if (result != nullptr) {
    napi_value body;
    const void* body_data = state.body.empty() ? nullptr : state.body.data();
    if (!CheckNapi(
            env,
            napi_create_buffer_copy(
                env, state.body.size(), body_data, nullptr, &body),
            "Failed to create native response body") ||
        !CheckNapi(
            env,
            napi_set_named_property(env, result, "body", body),
            "Failed to set native response body")) {
      result = nullptr;
    }
  }

  if (mime != nullptr) {
    curl_mime_free(mime);
  }
  if (header_list != nullptr) {
    curl_slist_free_all(header_list);
  }
  curl_easy_cleanup(curl);
  return result;
}

void CleanupCurl(void*) {
  curl_global_cleanup();
}

}  // namespace

NAPI_MODULE_INIT() {
  const CURLcode init_code = curl_global_init(CURL_GLOBAL_DEFAULT);
  if (init_code != CURLE_OK) {
    napi_throw_error(env, nullptr, curl_easy_strerror(init_code));
    return nullptr;
  }

  napi_add_env_cleanup_hook(env, CleanupCurl, nullptr);

  napi_value request_function;
  if (!CheckNapi(
          env,
          napi_create_function(
              env,
              "request",
              NAPI_AUTO_LENGTH,
              Request,
              nullptr,
              &request_function),
          "Failed to create native request function") ||
      !CheckNapi(
          env,
          napi_set_named_property(env, exports, "request", request_function),
          "Failed to export native request function")) {
    return nullptr;
  }

  return exports;
}
