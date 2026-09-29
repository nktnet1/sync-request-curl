## Differences from `sync-request`

### Additions

- `Response#getJSON()` is available as a convenience helper.
- `cache: "memory"` is available as an alternative to the file cache.
- `retry` and `retryDelay` can be callbacks when you need to decide retry
  behaviour at runtime. Transport failures passed to these callbacks are
  `CurlError` instances with numeric libcurl error codes rather than Node
  `ErrnoException` errors.
- `agent` still accepts the boolean values supported by `sync-request`, and can
  also take a keep-alive Node `Agent` for connection reuse.
- `overallTimeout` sets a deadline for the whole operation, alongside the
  per-attempt `timeout` and inactivity `socketTimeout` options.
- Proxy, TLS, local network binding, and TCP keepalive have dedicated options.

### Behavioural differences

- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) defines request
  framing independently of the method, so request content is permitted on
  `GET`, `DELETE`, and `HEAD`. The standard also notes that this content has no
  generally defined semantics and may be rejected by some implementations.
- Falsy JSON values such as `false`, `0`, `""`, and `null` are valid payloads.
- Invalid HTTP framing is rejected rather than sending conflicting
  `Content-Length` and `Transfer-Encoding` headers.
- Only absolute `http:` and `https:` URLs are accepted. Proxy environment
  variables are ignored. Use the `proxy` option when proxying a request.
- An explicit `Authorization` header takes precedence over credentials in the
  URL, and a caller-supplied `Accept-Encoding` header is left unchanged.
- 307 and 308 redirects preserve the request method and body. `sync-request`
  can rewrite some body-bearing redirects to `GET`.
- Query merging preserves additional literal `?` and `#` delimiters that
  `sync-request` can truncate while splitting URLs.
- Cache handling is stricter: `no-store` takes precedence, `Age` is updated on
  cache hits, cached headers are isolated from mutation, and recoverable
  cache-read errors are treated as misses.
- HTTPS requests can negotiate HTTP/2 automatically when supported.
