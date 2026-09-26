# v5 roadmap

## Goal

Make `sync-request-curl` a transport-neutral superset of the Node.js API and
features provided by `sync-request`, while keeping the existing synchronous
in-process native transport and the `Response#getJSON()` helper.

Public APIs keep `CurlError` as the compatibility surface for raw libcurl
transport failures. Other native transport details stay behind the TypeScript request
layer.

## Foundation

- [x] Remove the public node-libcurl-style API (`setEasyOptions`, `Easy`,
      `CurlOption`, `formData`, and `HttpPostField`) while retaining `CurlError`
      with its numeric libcurl error code.
- [x] Keep `Response#getJSON()` as an additive API.
- [x] Support `string | URL` request URLs and arbitrary case-insensitive
      string HTTP methods, including extension/WebDAV verbs.
- [x] Replace multipart `formData` input with `sync-request`-style `FormData`
      and `form`.
- [x] Keep redirects and overall request timeout orchestration in TypeScript.
- [x] Use transport-neutral request and response errors.
- [x] Organise `src` by responsibility while retaining `#/...` package-import
      aliases. Use subfolders only for cohesive multi-file areas (`request`,
      `http`, and `native`); keep single-file modules at the `src` root.

## `sync-request` compatibility

- [x] Add `allowRedirectHeaders` with case-insensitive redirect-header
      allow-list semantics.
- [x] Add `gzip`, enabled by default, with transparent response decompression
      and an explicit opt-out.
- [x] Add `retry`, `retryDelay`, and `maxRetries` with `sync-request`
      compatible defaults and retry conditions.
- [x] Add `socketTimeout` as an inactivity timeout. Keep it distinct from the
      existing overall `timeout` deadline.
- [x] Resolve `agent` compatibility with real cross-request connection reuse;
      do not map it to TCP keepalive and call that equivalent.
- [x] Implement `cache: "file"` with correct HTTP cache semantics rather than
      a response-body-only disk cache.
- [x] Add `Blob` multipart values where they can be supported synchronously
      without depending on private runtime internals.
- [x] Verify CommonJS compatibility for `request.FormData` in the built
      package, with matching `FormData` coverage through the existing ESM
      `./types` entry.
- [x] Match upstream `getBody()` status-error messages, including decoding the
      response body with the requested encoding.
- [x] Expose `FormData` as a named export from the root ESM entry and restore
      upstream-style root named public types while preserving direct callable
      CommonJS `require("sync-request-curl")`.
- [x] Match `then-request` query parsing/merging/stringifying semantics for
      `qs`, including nested values and RFC3986 byte encoding.

## Additional transport-neutral features

Replace useful capabilities that were previously reachable through
`setEasyOptions` with explicit high-level options where appropriate:

- [ ] Proxy URL and proxy authentication.
- [ ] TLS verification and custom CA configuration.
- [ ] Local interface/address binding.
- [ ] TCP keepalive configuration.
- [x] Use `CurlError` with the raw numeric libcurl code for native transport
      failures; keep `RequestError` for errors created by the TypeScript layer.

## Tests

- [x] Port the applicable upstream `sync-request` Node.js behaviours into a
      focused public-API compatibility suite.
- [x] Cover redirect-header allow-list behaviour for same-origin and
      cross-origin redirects.
- [x] Cover compressed responses and `gzip: false`.
- [x] Cover retry count, delay, HTTP error retries, and transport error retries.
- [x] Cover `socketTimeout` with streaming responses that both remain active
      and become inactive.
- [x] Cover agent-scoped connection reuse and one-shot agent behaviour.
- [x] Cover file-cache freshness, validators, and cache bypass/revalidation.
- [x] Add built-package smoke tests for the current ESM and CommonJS exports.
- [x] Extend built-package smoke tests to the upstream-style root ESM named
      `FormData` export once that packaging change lands.
- [ ] Keep native loading/prebuild coverage for every supported platform key.

## Parity assessment (2026-09-25)

The Node.js `sync-request` surface is now substantially covered: request URLs,
headers, body/JSON/multipart payloads, redirects, gzip handling, overall and
socket timeouts, GET retry behaviour, file caching, agent-scoped connection
reuse, and the response shape are all represented. `getJSON()` remains an
intentional additive helper.

The focused compatibility suite now covers the observable Node.js request
surface together with `then-request`-style `qs` parse/merge/stringify
semantics, including nested values, indexed arrays, existing-query reparsing,
and RFC3986 byte encoding.

For useful `then-request` features that remain naturally synchronous in this
in-process implementation, v5 also supports `cache: "memory"` and
function-valued `retry`/`retryDelay` policies. These are intentionally additive
to the narrower `sync-request` type surface.

Custom callback caches and stream request bodies remain outside the target:
supporting them faithfully would require adapting asynchronous stream/callback
contracts into a synchronous API. The lower-level `http-basic` duplex stream
API and cache implementation hooks are likewise not parity targets. Cache
policy callbacks (`isMatch`, `isExpired`, and `canCache`) should only be added
if they can be exposed with a buffered synchronous contract without pretending
to provide the upstream stream-shaped callback objects.

Request orchestration now follows the effective upstream Node.js layering for
each redirect hop: redirect handling wraps cache lookup/storage, cache wraps
retry, and retry wraps the native transport. Fresh cache hits therefore bypass
retry callbacks, cacheable error responses are only stored after retries finish,
and a failure on a later redirect hop retries that hop instead of replaying the
redirect chain. The existing TypeScript overall-timeout budget across redirects
is retained rather than copying `http-basic` timeout quirks.

### Remaining strict Node.js parity findings

These are observable differences found while comparing the local sources for
`sync-request`, `then-request`, and, only where necessary, `http-basic`. They are
not all necessarily desirable behaviours to copy.

- [x] Accept `null` request options at runtime and normalise them to `{}`,
      matching `sync-request`'s `options || ...` runtime behaviour. Keep the
      public TypeScript signature as `options?: Options`, matching upstream;
      `null` is legacy runtime compatibility rather than a declared input type.
      Direct `optionsSchema` validation remains strict and continues to reject
      `null`.
- [x] Match upstream payload precedence and caller-header preservation where it
      maps cleanly to the buffered API. Payload selection is `form` before
      `json` before `body`; generated JSON `Content-Type` only fills a missing
      header; and empty GET/DELETE/HEAD requests no longer receive a generated
      `Content-Length: 0`. Empty methods that upstream treats as body-capable
      still receive `Content-Length: 0`. Caller-supplied `Content-Length` is
      preserved only when it is valid and matches the exact buffered payload
      size, as required by the later standards-driven framing validation.
- [x] Remove `content-encoding` from the exposed response headers after
      transparent gzip/deflate decompression so the headers describe the body
      actually returned to callers. Also remove the encoded representation's
      stale `content-length`; do not fabricate a decoded length. Preserve both
      headers when decompression is disabled, unsupported, or fails.
- [x] Match Node's duplicate response-header folding: expose `set-cookie` as
      an array even when only one value is present, join repeated `cookie`
      values with `; `, join ordinary repeated headers with `, `, and keep the
      first value for Node's singleton-header set.
- [x] Match Node's outbound request-header validation inherited by
      `http-basic`: validate names as HTTP tokens, reject invalid/control
      characters in values (including every repeated value), and reject
      `undefined` header values instead of silently dropping them. Valid empty
      values, horizontal tabs, and token punctuation remain supported.
- [x] Keep raw `body` media-type neutral: when the caller does not supply
      `Content-Type`, suppress libcurl's `CURLOPT_POSTFIELDS` default of
      `application/x-www-form-urlencoded` instead of inventing a form media
      type for arbitrary string/Buffer content. JSON and multipart payloads
      keep their generated media types, and explicit caller values are
      preserved.
- [x] Validate response message framing before exposing headers: accept and
      normalize repeated `Content-Length` values only when every decimal value
      agrees, reject invalid or conflicting lengths, and reject responses that
      combine `Content-Length` with `Transfer-Encoding`. Parse captured response
      headers before surfacing libcurl transport failures so libcurl's own
      malformed-framing rejection cannot mask the library's deterministic
      `RequestError`. This follows RFC 9112 rather than copying Node's stricter
      rejection of all duplicate `Content-Length` fields.
- [x] Reject outbound request framing that combines caller-supplied
      `Content-Length` with `Transfer-Encoding`. RFC 9112 forbids senders from
      emitting both fields in one message; fail before cache, retry, or native
      transport rather than preserving Node/`then-request`'s permissive
      behaviour.
- [x] Validate caller-supplied `Content-Length` whenever the exact request
      payload size is known. The value must use the `1*DIGIT` grammar, repeated
      outbound fields are rejected, and the decimal value must match the actual
      byte length of raw/JSON content or the known zero-length empty request.
      Matching values (including leading zeroes) are preserved. Empty
      GET/DELETE/HEAD requests still do not gain a generated length, but an
      explicit non-zero length is rejected. This intentionally fixes the
      permissive Node/`then-request` behaviour rather than forwarding framing
      metadata known to be incorrect, which RFC 9110 section 8.6 forbids.
      Multipart remains separate because native libcurl serialization owns its
      final boundary and encoded size.
- [x] Restrict public request targets and followed redirects to absolute
      `http:`/`https:` URLs. Reject schemeless targets instead of allowing
      libcurl to guess a protocol, and reject non-HTTP schemes before they can
      reach the native transport. Preserve the existing public malformed-URL
      contract by surfacing syntactically invalid/schemeless targets as
      `CurlError` code 3 rather than leaking Node's `TypeError` from `new URL()`.
- [x] Disable libcurl's ambient proxy-environment discovery. Requests do not
      implicitly inherit `http_proxy`, `HTTPS_PROXY`, `ALL_PROXY`, or related
      variables; proxy routing remains an explicit future high-level option.
- [x] Enforce HTTP method semantics that the generic libcurl custom-method path
      cannot model safely: reject CONNECT because the buffered API cannot expose
      its tunnel, reject non-empty TRACE content, and require `Content-Type` for
      OPTIONS requests that contain content.
- [x] Reject caller-supplied `Content-Length` for multipart forms. The final
      MIME boundary and encoded byte length are owned by libcurl, so the
      TypeScript layer cannot verify a caller assertion safely; libcurl remains
      solely responsible for multipart framing.

Intentional differences: do not reproduce `then-request`'s early rejection of a
`body` on GET, DELETE, or HEAD. `sync-request-curl` passes explicit request
payloads through to libcurl for those methods, including the corresponding
generated payload length when the caller did not provide one. Falsy JSON values
(`false`, `0`, `""`, and `null`) also remain valid JSON payloads instead of
copying `then-request`'s truthiness check. An explicit `Transfer-Encoding`
suppresses generation of `Content-Length`; if the caller explicitly supplies
both `Content-Length` and `Transfer-Encoding`, request preparation rejects the
ambiguous framing instead of copying Node/`then-request`'s permissive
behaviour. Likewise, do not copy
upstream implementation quirks such as treating `retryDelay: 0` as the default
delay, treating `maxRetries: 0` as the default retry count, or lower-level
stream/callback APIs that do not map cleanly to a synchronous buffered
interface.

For HEAD specifically, request content is allowed as an intentional extension
even though RFC 9110 gives it no generally defined semantics. The native
transport must still preserve HEAD response semantics: payload bytes are sent,
but the transfer completes after the final response headers and exposes an
empty response body. This avoids libcurl's `CURLOPT_NOBODY` suppressing request
content or its body-capable request mode waiting for response bytes that a HEAD
server does not send.

## TypeDoc

Keep `README.md` at the pre-v5 develop version until the public API and
documentation generation are ready to be updated together. Track interim
documentation decisions here instead of rewriting the README piecemeal.

Adopt the documentation-generation approach from `date-fns-holidays` while
using this repository's own paths and metadata.

- [ ] Add TypeDoc, `typedoc-plugin-markdown`, and `typedoc-plugin-remark`.
- [ ] Add the Remark plugins used for GitHub links, generated headings, and
      the table of contents.
- [ ] Add `typedoc.json` and an `assets/BASE.md` documentation base.
- [ ] Generate Markdown API documentation from `src/index.ts` and merge it into
      the published README workflow.
- [ ] Add JSDoc for public request options, response APIs, multipart APIs, and
      errors, including defaults and compatibility notes.
- [ ] Document nested `qs` bracket serialization and unsupported query-value
      behaviour with the rest of the generated request-option documentation.
- [ ] Group generated API docs by request, response, multipart, and errors.
- [ ] Add CI verification that generated documentation is committed and not
      stale.

## Release readiness

- [ ] Document intentional Node-only differences from upstream
      `sync-request`; browser synchronous-XHR support is not a v5 target.
- [ ] Add a v4-to-v5 migration section for removed node-libcurl-specific APIs.
- [ ] Verify package exports, declaration files, prebuild staging, and clean
      installation from a packed tarball.
- [ ] Run the full Vitest, typecheck, lint, formatting, native, and prebuild
      verification suites before the v5 release.

## Implemented compatibility notes (2026-09-25)

The following work has already landed in the incremental v5 patch series and
should be treated as the current baseline in future sessions:

- `v1.0.0-file-cache-compatibility.patch` added the `sync-request`-compatible
  `cache: "file"` surface with HTTP-aware disk caching, explicit freshness,
  ETag/Last-Modified revalidation, `Vary` handling, cached redirects, and
  invalidation after successful unsafe methods.
- `v1.0.1-cache-retry-regressions.patch` made caller `Cache-Control: no-cache`
  perform a real origin fetch/replacement and isolated cache timestamps from
  non-cached retry timeout accounting.
- `v1.0.2-cache-coverage-lint.patch` fixed the assignment-in-expression lint
  finding and added focused cache policy/filesystem failure coverage.
- `v1.0.3-cache-branch-coverage-sonar.patch` covered the remaining cache
  branches and cleaned up Sonar findings in native platform selection and
  agent option validation without changing runtime semantics.
- The follow-up quality pass removes duplicated `Vary` request-header matching,
  avoids analyzer-sensitive dynamic object/array access in cache comparisons,
  uses deterministic `localeCompare` sorting, prefers `Number.NaN`, and
  documents the safety invariant around SHA-512-derived cache file paths.
- `v1.0.5-cache-coverage.patch` makes the normalized request-header value
  helper coverage-stable and explicitly covers duplicate `Cache-Control`
  request headers so the file-cache implementation reaches full line/statement
  coverage without changing runtime behaviour.
- `v1.0.6-cache-vary-length-coverage.patch` explicitly covers the `Vary`
  request-header vector length-mismatch path, ensuring cache entries do not
  match when a repeated varied request header changes the number of values.
- `v1.0.7-blob-multipart.patch` accepts Node `Blob`/`File` multipart values,
  materialises their bytes synchronously through public worker-thread APIs,
  preserves filename and MIME metadata without relying on private Blob internals,
  and smoke-tests Blob append on the Node 16.17 runtime floor.
- `v1.0.8-commonjs-formdata-built-package.patch` verifies the built CommonJS
  entry is directly callable through `require()` and exposes the same
  `request.FormData` constructor as the named `FormData` export, with matching
  ESM coverage in the runtime compatibility matrix.
- `v1.0.9-sync-request-parity-closure.patch` accepts arbitrary
  case-insensitive string HTTP methods (including extension verbs), restores
  the upstream `getBody()` status-error body/encoding text, and records the
  remaining `sync-request`/`then-request`/`http-basic` parity boundaries.
- `v1.0.10-upstream-compatibility-suite.patch` adds a focused end-to-end
  public-API suite for the applicable `sync-request` Node.js behaviours: basic
  response shape, query appending, headers, string/Buffer/JSON bodies,
  `request.FormData`, redirects, `getBody()` errors, and HEAD responses.
- `v1.0.12-root-esm-exports.patch` adds a dedicated ESM package entry that
  exposes `FormData` and the public named types from the package root while
  retaining the single-default CommonJS entry for directly callable
  `require("sync-request-curl")`, with conditional declaration exports and
  built-package runtime/type smoke coverage.
- `v1.0.13-esm-only-root-entry.patch` builds that dedicated root entry only
  as ESM, eliminating tsdown's mixed-export CommonJS warning and the unused
  `index-esm.cjs`/`index-esm.d.cts` artifacts while preserving the callable
  CommonJS `index.cjs` entry.
- `v1.0.14-typescript-7-root-export-smoke.patch` makes the one-file root
  export type smoke test explicit about ignoring the repository `tsconfig.json`,
  satisfying TypeScript 6+/7 TS5112 while retaining the isolated NodeNext
  package-export check.
- `v1.0.15-coverage-entry-validation.patch` excludes the packaging-only
  `src/index-esm.ts` re-export shim from source coverage (matching `src/index.ts`)
  and adds runtime coverage for uppercase HTTP method validation.
- `v1.0.16-knip-native-deps-entry.patch` adds an explicit Knip entry for
  `scripts/verify-native-deps.ts`, which is executed dynamically by the Linux
  prebuild workflow and therefore is not discoverable as a static module edge.
- `v1.0.17-then-request-qs-compatibility.patch` replaces WHATWG query
  serialization with the `then-request`/`qs` compatibility model: existing
  query strings are parsed with nested/indexed-array defaults, caller `qs`
  values replace top-level keys, and the merged result is serialized with
  indexed brackets and RFC3986 encoding.
- `v1.0.18-qs-parser-coverage.patch` covers the remaining query parser and
  merge conflict branches from the initial compatibility implementation.
- `v1.0.19-use-qs-package.patch` replaces that local compatibility parser and
  serializer with the maintained `qs` package itself, keeping behaviour tied
  directly to the same dependency family used by `then-request` and removing
  the custom parsing/encoding maintenance surface.
- `v1.0.20-qs-test-expectations.patch` updates the legacy parser edge-case
  expectations to the actual `qs` parse/stringify output now that `qs` is the
  implementation, keeping tests aligned with upstream behaviour rather than the
  removed local compatibility parser.
- `v1.0.21-url-null-prototype-coverage.patch` covers the remaining
  `appendQueryString` plain-object validation branch with a null-prototype
  top-level query object, without changing runtime behaviour.
- `v1.0.24-remove-debug-option.patch` supersedes the temporary v1.0.22/v1.0.23
  debug work by removing the request debug option and all request-input
  serialization from transport errors.
- `v1.0.25-then-request-sync-parity.patch` adds the two useful
  `then-request` features that map directly to the synchronous in-process
  architecture: HTTP-aware in-memory caching and function-valued GET retry and
  retry-delay policies with one-based attempt context.
- `v1.0.28-retry-cache-ordering.patch` moves GET retry below the cache layer
  on each redirect hop, matching the effective upstream request ordering. Cache
  hits bypass retry policy, cache writes happen after retry completion, and a
  failing redirected hop is retried without replaying earlier hops. It also
  records the remaining strict Node.js parity findings and the intentional
  GET/DELETE/HEAD request-body difference.
- `v1.0.29-payload-header-parity.patch` aligns buffered payload precedence with
  `then-request` (`form` before `json` before `body`), preserves caller-supplied
  payload headers, avoids generating `Content-Length: 0` for empty
  GET/DELETE/HEAD requests, and records the intentional request-body and framing
  differences retained by the libcurl transport.
- `v1.0.30-null-options-runtime-compat.patch` restores upstream runtime
  compatibility for callers that pass `null` as the request options value by
  normalising it to an empty object at the public request boundary. The
  TypeScript declaration remains `options?: Options`, and direct schema
  validation remains strict.
- `v1.0.31-decompression-header-parity.patch` removes `content-encoding` from
  exposed response headers after successful transparent gzip/deflate
  decompression, matching the attached `http-basic` behaviour while retaining
  the header when decompression is disabled, unsupported, or not performed.
- `v1.0.32-node-response-header-folding.patch` matches the
  `IncomingMessage.headers` shape inherited by `http-basic`/`then-request`:
  `set-cookie` is always an array, repeated `cookie` values use `; `, ordinary
  repeated fields use `, `, and Node's singleton response headers keep their
  first value. This normalises the raw header lines supplied by libcurl; the
  later v1.0.37 framing patch adds standards-based rejection for ambiguous
  `Content-Length`/`Transfer-Encoding` responses without copying Node's
  stricter rejection of identical duplicate lengths.
- `v1.0.33-head-request-payloads.patch` makes the intentional HEAD request-body
  extension work end-to-end: explicit body, JSON, and multipart payloads are
  transmitted while the native transport still completes after the final HEAD
  response headers and returns an empty response body.
- `v1.0.34-node-request-header-validation.patch` matches the outbound header
  validation that `then-request` inherits from Node through `http-basic`, using
  Node's public validators for request-header names and values before libcurl
  serialization. Invalid names, CR/LF/control characters, invalid repeated
  values, and `undefined` values now fail with Node-compatible errors.
- `v1.0.35-raw-body-content-type.patch` keeps arbitrary raw request bodies
  media-type neutral. If no `Content-Type` is supplied, the native transport
  suppresses libcurl's `CURLOPT_POSTFIELDS` default
  `application/x-www-form-urlencoded`; explicit caller values and the generated
  JSON/multipart media types are unchanged.
- `v1.0.36-decompression-content-length.patch` removes the encoded
  representation's `content-length` after successful transparent gzip/deflate
  decompression alongside `content-encoding`, so exposed response metadata does
  not describe bytes that are no longer returned. Disabled, unsupported, and
  failed decompression preserve the original headers. This intentionally
  fixes an attached `http-basic` bug: its decompression wrapper deletes
  `content-encoding` but leaves the compressed `content-length` exposed.
- `v1.0.37-response-framing-validation.patch` validates final response framing
  before Node-style header folding can hide ambiguity: identical duplicate or
  comma-separated `Content-Length` values are reduced to one field, conflicting
  or syntactically invalid lengths fail the request, and `Content-Length` plus
  `Transfer-Encoding` is rejected. This is deliberately standards-driven:
  upstream Node rejects duplicate `Content-Length` fields even when identical,
  while RFC 9112 permits recipients to normalize identical values.
- `v1.0.38-framing-error-precedence.patch` parses any response headers already
  captured by the native callback before converting a non-zero libcurl result
  into `CurlError`. Newer libcurl releases can reject conflicting or malformed
  `Content-Length` values themselves with `CURLE_WEIRD_SERVER_REPLY`; this keeps
  the public error deterministic by preserving the more specific standards-level
  `RequestError`, while unrelated transport failures still remain `CurlError`.
- `v1.0.39-libcurl-framing-error-detail.patch` handles the remaining libcurl
  parser edge case where the rejected `Content-Length` line never reaches the
  header callback. The native transport now preserves libcurl's detailed
  `CURLOPT_ERRORBUFFER` message; `CURLE_WEIRD_SERVER_REPLY` with libcurl's
  `Invalid Content-Length` detail is translated into the same deterministic
  framing `RequestError`, using any previously captured final-response
  `Content-Length` to distinguish a conflict from a malformed first value.
  Other code-8 transport failures remain `CurlError`.
- `v1.0.40-request-framing-validation.patch` rejects outbound requests that
  explicitly contain both `Content-Length` and `Transfer-Encoding`, as required
  by RFC 9112. Validation runs immediately after Node-compatible header
  serialization and before generated headers, caching, retry, redirects, or
  native transport, while `Transfer-Encoding` by itself continues to suppress
  generated `Content-Length`. This intentionally fixes permissive behaviour
  inherited by `then-request`/`http-basic` from Node's request stack.
- `v1.0.41-header-branch-coverage.patch` removes an unreachable defensive
  branch from Content-Length candidate normalization and covers the fallback
  used when libcurl reports a Content-Length parser failure without a captured
  HTTP status line. This is test/coverage hardening only; public behaviour is
  unchanged.
- `v1.0.42-request-content-length-validation.patch` validates explicit outbound
  `Content-Length` against the exact byte size whenever request preparation
  knows it. Invalid syntax, repeated fields, mismatched raw/JSON lengths, and
  non-zero lengths on known-empty requests fail before transport; matching
  decimal values are preserved and empty GET/DELETE/HEAD requests still avoid
  an automatically generated zero length. This intentionally fixes the
  permissive Node/`then-request` behaviour in accordance with RFC 9110 section
  8.6. Multipart is unchanged because libcurl owns the final encoded form size.
- `v1.0.43-http-protocol-restriction.patch` restricts initial request targets
  and manually followed redirects to absolute HTTP(S) URLs before native
  transport. Schemeless targets no longer reach libcurl's protocol guessing,
  and schemes such as `file:` or FTP are rejected consistently with the Node
  `http-basic` transport boundary.
- `v1.0.44-disable-ambient-proxy-env.patch` explicitly disables libcurl's
  environment-proxy discovery for the native transport, preventing process
  variables such as `http_proxy`, `HTTPS_PROXY`, and `ALL_PROXY` from silently
  changing routing. Proxy support remains reserved for the explicit roadmap
  option rather than ambient process state.
- `v1.0.45-malformed-url-curl-error.patch` keeps the HTTP(S)-only URL
  restriction without regressing the established malformed-URL error contract.
  Invalid or schemeless absolute targets fail before transport as `CurlError`
  code 3, matching the public error shape callers received from libcurl before
  protocol pre-validation was added; valid non-HTTP schemes remain rejected as
  unsupported protocols.
- `v1.0.46-http-method-semantics.patch` enforces semantics that cannot be
  represented by a generic buffered custom-method request: CONNECT is rejected,
  TRACE cannot carry non-empty content, and OPTIONS content must have a non-empty
  `Content-Type` (with JSON and libcurl-generated multipart types accepted).
  Empty TRACE raw bodies remain valid because they carry no content.
- `v1.0.47-multipart-content-length-safety.patch` rejects explicit
  `Content-Length` on multipart form requests. Because libcurl constructs the
  MIME boundary and final encoded body, request preparation cannot verify a
  caller-supplied length; leaving multipart length generation entirely to
  libcurl preserves the outbound framing guarantees added in v1.0.42.

Do not replace these behaviours with a response-body-only cache or move retry
and redirect orchestration into the native transport; those choices are
intentional compatibility boundaries for v5.
