# Contributing

## Project scope

`sync-request-curl` targets the Node.js API surface of `sync-request` while
keeping a synchronous in-process native transport. Browser synchronous-XHR
support is not a target.

Keep the public API transport-neutral. Raw libcurl transport failures remain
available through `CurlError` and its numeric curl error code, but other native
transport details should stay behind the TypeScript request layer.

Redirect, cache, retry, and deadline orchestration belongs in TypeScript. The
native addon is the transport boundary. Do not replace the HTTP-aware cache with
a response-body-only cache or move request orchestration into the native layer.
Features that fundamentally require asynchronous stream or callback contracts,
such as stream request bodies, custom callback caches, or the lower-level
`http-basic` duplex API, are outside the compatibility target unless they can be
expressed honestly as a buffered synchronous API.

## Documentation

`README.md` is generated. Do not edit it directly.

Hand-written README content lives in `typedoc/assets/`, while public API content
comes from exported declarations and their JSDoc. `typedoc/generate.ts` combines
those sources and writes the complete README.

Use `pnpm docs:gen` to regenerate it and `pnpm docs:check` to verify that the
tracked output is current.

## Release validation

`pnpm test:verdaccio` is the repository's packed-package smoke test. It stages
the main package and current-platform native package, publishes both to a
disposable local registry, verifies the optional-dependency metadata, and tests
a clean install. It is not currently part of the normal pull-request pipeline
or `release:beta` checks.

## Tests

Avoid copy/pasted test and callback boilerplate. When cases share setup and
assertions and differ only by inputs or expected values, prefer `test.for`,
`test.each`, or a focused local helper.

When a shared diagnostic fixture returns multiple fields, assert only the fields
owned by the behaviour under test unless the complete response shape is itself
the contract.

Native FFI callbacks should centralise pointer/length validation, panic
containment, and activity tracking in shared helpers rather than duplicating
unsafe boundary code.
