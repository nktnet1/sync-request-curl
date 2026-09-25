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
      `json` before `body`; generated JSON `Content-Type` and payload
      `Content-Length` only fill missing headers; and empty GET/DELETE/HEAD
      requests no longer receive a generated `Content-Length: 0`. Empty
      methods that upstream treats as body-capable still receive
      `Content-Length: 0`.
- [x] Remove `content-encoding` from the exposed response headers after
      transparent gzip/deflate decompression so the headers describe the body
      actually returned to callers. Preserve the header when decompression is
      disabled or the encoding is unsupported.
- [ ] Match Node's duplicate response-header folding where useful: preserve
      `set-cookie` as an array, join `cookie` with `; `, join ordinary repeated
      headers with `, `, and apply Node's singleton-header duplicate rules.

Intentional differences: do not reproduce `then-request`'s early rejection of a
`body` on GET, DELETE, or HEAD. `sync-request-curl` passes explicit request
payloads through to libcurl for those methods, including the corresponding
generated payload length when the caller did not provide one. Falsy JSON values
(`false`, `0`, `""`, and `null`) also remain valid JSON payloads instead of
copying `then-request`'s truthiness check. An explicit `Transfer-Encoding`
suppresses generation of `Content-Length`, while an explicitly supplied
`Content-Length` is preserved; this avoids manufacturing conflicting framing
headers while still respecting caller-provided values. Likewise, do not copy
upstream implementation quirks such as treating `retryDelay: 0` as the default
delay, treating `maxRetries: 0` as the default retry count, or lower-level
stream/callback APIs that do not map cleanly to a synchronous buffered
interface.

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

Do not replace these behaviours with a response-body-only cache or move retry
and redirect orchestration into the native transport; those choices are
intentional compatibility boundaries for v5.
