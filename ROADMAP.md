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
- [ ] Match `then-request` query parsing/merging/stringifying semantics for
      `qs`, including nested values and RFC3986 byte encoding.

## Additional transport-neutral features

Replace useful capabilities that were previously reachable through
`setEasyOptions` with explicit high-level options where appropriate:

- [ ] Redact credentials and other sensitive values from debug error details
      before adding credential-bearing transport options.
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

The remaining observable compatibility work is narrower but important:

- `qs` currently uses the WHATWG URL/query implementation rather than the
  `qs` parse/merge/stringify behaviour inherited from `then-request`; nested
  merge and byte-encoding details therefore still need compatibility tests
  and alignment.

Features exposed by `then-request`/`http-basic` but explicitly excluded by
`sync-request` are not v5 parity gaps: memory/custom caches and function-valued
retry policies are examples. Async/streaming-only lower-level features such as
`ReadableStream` request bodies, `duplex`, and cache implementation hooks are
also outside the synchronous Node.js compatibility target unless a separate
high-level use case is added later.

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


Do not replace these behaviours with a response-body-only cache or move retry
and redirect orchestration into the native transport; those choices are
intentional compatibility boundaries for v5.
