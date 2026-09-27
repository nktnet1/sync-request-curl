## Differences from `sync-request`

Version 5 targets the observable Node.js `sync-request` API while keeping the in-process libcurl transport. The detailed compatibility decisions and rationale are tracked in [ROADMAP.md](ROADMAP.md); the practical differences are summarised here.

### Intentional additions

- `Response#getJSON()` is retained as a convenience helper.
- `cache: "memory"` is available in addition to `sync-request`'s file-cache surface.
- `retry` and `retryDelay` may be callbacks for synchronous policy decisions.
- A real keep-alive Node `Agent` may be supplied for additive connection-pool reuse; the upstream-compatible boolean `agent` values remain accepted.
- `overallTimeout` provides a complete-operation deadline in addition to the per-attempt `timeout` and inactivity `socketTimeout` controls.
- Explicit high-level proxy, TLS, source binding, and TCP keepalive options replace the old node-libcurl-specific callback surface.

### Intentional behavioural differences

- The package is Node-only; browser synchronous-XHR support is not a v5 target.
- Explicit bodies on `GET`, `DELETE`, and `HEAD` remain supported, and falsy JSON values such as `false`, `0`, `""`, and `null` are valid payloads.
- Invalid or ambiguous HTTP framing is rejected instead of forwarding known-bad `Content-Length` / `Transfer-Encoding` combinations.
- Only absolute `http:` and `https:` targets are accepted. Ambient proxy environment variables are ignored; proxy routing is explicit through `proxy`.
- Caller-supplied `Authorization` remains authoritative over URL credentials, and caller-supplied `Accept-Encoding` is preserved exactly.
- Redirects preserve method and payload for 307/308, rather than reproducing the upstream wrapper bug that can rewrite body-bearing requests to GET.
- Query merging preserves additional literal `?` and `#` delimiters that upstream can truncate while splitting URLs.
- Cache handling intentionally keeps `no-store` precedence, updates `Age` on hits, isolates mutable cached headers, and treats recoverable cache read failures as misses instead of reproducing upstream cache quirks.
- Where supported by the bundled/system libcurl, HTTPS requests may negotiate HTTP/2 instead of being forced to HTTP/1.1 solely for Node `http` parity.

### Out of scope

The synchronous buffered API does not attempt to expose lower-level asynchronous or stream-shaped internals that `sync-request` itself does not forward cleanly: stream request bodies, callback cache implementations and cache-policy hooks, `http-basic` duplex behaviour, `ignoreFailedInvalidation`, or the internal `fromCache` / `fromNotModified` flags.

### Migrating from v4

The public node-libcurl-style API has been removed. Replace `setEasyOptions`, `Easy`, and `CurlOption` with the high-level options documented above: `proxy` / `proxyAuth`, `rejectUnauthorized` / `caFile`, `localAddress` / `localInterface`, and `tcpKeepAlive`. Replace the old `formData` / `HttpPostField` request shape with `FormData` passed through `form`. `CurlError` remains available for raw libcurl transport failures.
