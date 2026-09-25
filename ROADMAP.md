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
- [x] Support `string | URL` request URLs and case-insensitive HTTP methods.
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
- [ ] Implement `cache: "file"` with correct HTTP cache semantics rather than
      a response-body-only disk cache.
- [ ] Add `Blob` multipart values where they can be supported synchronously
      without depending on private runtime internals.
- [ ] Verify CommonJS compatibility for `request.FormData` in the built
      package, in addition to the named ESM export.

## Additional transport-neutral features

Replace useful capabilities that were previously reachable through
`setEasyOptions` with explicit high-level options where appropriate:

- [ ] Proxy URL and proxy authentication.
- [ ] TLS verification and custom CA configuration.
- [ ] Local interface/address binding.
- [ ] TCP keepalive configuration.
- [x] Use `CurlError` with the raw numeric libcurl code for native transport
      failures; keep `RequestError` for errors created by the TypeScript layer.
- [ ] Redact credentials and other sensitive values from debug error details.

## Tests

- [ ] Port the applicable upstream `sync-request` Node.js tests into a focused
      compatibility suite.
- [x] Cover redirect-header allow-list behaviour for same-origin and
      cross-origin redirects.
- [x] Cover compressed responses and `gzip: false`.
- [x] Cover retry count, delay, HTTP error retries, and transport error retries.
- [x] Cover `socketTimeout` with streaming responses that both remain active
      and become inactive.
- [x] Cover agent-scoped connection reuse and one-shot agent behaviour.
- [ ] Cover file-cache freshness, validators, and cache bypass/revalidation.
- [ ] Add built-package smoke tests for ESM and CommonJS exports.
- [ ] Keep native loading/prebuild coverage for every supported platform key.

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
