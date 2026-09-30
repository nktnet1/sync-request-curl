## Differences from sync-request

### Additions

- `Response#getJSON()` is available as a convenience helper.
- `cache: "memory"` is available as an alternative to the file cache.
- `isMatch`, `isExpired`, and `canCache` expose the synchronous cache-policy
  hooks from [`http-basic`](https://github.com/ForbesLindesay/http-basic).
  Callback/stream-based custom cache implementations remain out of scope; use
  the built-in `"file"` or `"memory"` cache.
- `retry` and `retryDelay` can be callbacks when you need to decide retry
  behaviour at runtime. Transport failures passed to these callbacks are
  `CurlError` instances with numeric libcurl error codes, while response parser
  failures are `RequestError` instances rather than Node `ErrnoException` errors.
- `agent` still accepts the boolean values supported by
  [`sync-request`](https://github.com/ForbesLindesay/sync-request),
  and can also take a keep-alive Node `Agent` for connection reuse.
- `overallTimeout` sets a deadline for the whole operation, alongside the
  response-header `timeout` and inactivity `socketTimeout` options.
- TLS, local network binding, and TCP keepalive have dedicated options.

### Behavioural differences

- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) defines request
  framing independently of the method, so request content is permitted on
  `GET`, `DELETE`, and `HEAD`. The standard also notes that this content has no
  generally defined semantics and may be rejected by some implementations.
- Falsy JSON values such as `false`, `0`, `""`, and `null` are valid payloads.
- `Response#getBody()` throws `ResponseError` for HTTP status codes >= 300. It
  still extends `Error` and exposes `statusCode`, `headers`, and `body`, but its
  `name` is `"ResponseError"` rather than sync-request's default `"Error"`.
- Invalid HTTP framing is rejected rather than sending conflicting
  `Content-Length` and `Transfer-Encoding` headers.
- Obsolete HTTP/1 response line folding is normalised to spaces as required for
  user agents by [RFC 9112](https://www.rfc-editor.org/rfc/rfc9112.html).
  `sync-request` inherits Node's stricter parser, which can reject those
  responses instead.
- `CONNECT` is rejected explicitly. Although `sync-request` accepts it at the
  type level, its underlying buffered request stack does not complete a
  successful CONNECT tunnel response.
- libcurl applies RFC 3986 URL normalisation, including removal of `.` and `..`
  path segments. `Response#url` reports libcurl's effective URL, so it can
  reflect that normalisation instead of preserving the caller's literal URL.
- An explicit `Authorization` header takes precedence over credentials in the
  URL, and a caller-supplied `Accept-Encoding` header is left unchanged.
- 307 and 308 redirects preserve the request method and body.
  [`sync-request`](https://github.com/ForbesLindesay/sync-request)
  can rewrite some body-bearing redirects to `GET`.
- A redirect response without a `Location` header is returned unchanged rather
  than being converted into an exception.
  [RFC 9110's redirection semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)
  define automatic redirection in terms of a provided `Location` value. This
  intentionally differs from `http-basic`, which throws when a redirect status
  has no redirect target.
- Query merging preserves additional literal `?` and `#` delimiters that
  [`sync-request`](https://github.com/ForbesLindesay/sync-request) can truncate
  while splitting URLs.
- Default cache handling is stricter: `no-store` takes precedence, `Age` is
  updated on cache hits, cached headers are isolated from mutation, and
  recoverable cache-read errors are treated as misses.
- HTTPS requests can negotiate HTTP/2 automatically when supported.
