# Native addon

The native addon is a synchronous Rust Node-API wrapper around libcurl. It uses
`napi-rs` with Node-API v8, so release binaries are tied to the operating system,
CPU architecture, and C runtime rather than to a specific Node.js major.

The Rust layer intentionally keeps libcurl underneath the public API. That
preserves curl error codes and the existing proxy, TLS, interface, DNS,
keepalive, raw-body, and multipart behaviour instead of changing HTTP stacks as
part of the language migration.

## Building locally

Local native builds require Rust 1.88 or newer, Node.js, and the platform C
toolchain used by the vendored libcurl/OpenSSL build (Xcode Command Line Tools,
MSVC Build Tools, or a Linux build-essential equivalent):

```sh
pnpm build:native
pnpm test
```

`rust-toolchain.toml` pins the repository toolchain. `pnpm test` builds the
local addon only when no matching prebuild is available or the local native
output is stale.

The build uses Cargo and produces:

```text
native/build/sync_request_curl_native.node
```

`curl-sys` builds bundled libcurl with HTTP/2 enabled on Linux and Windows. Linux TLS
uses vendored OpenSSL, Windows uses Schannel, and macOS links the system libcurl so
certificate verification uses Apple's native trust configuration. zlib is forced
static in the prebuild path. The Linux GCC unwinding runtime (`libgcc_s`) may
remain dynamically linked; the dependency verifier permits this platform runtime
while rejecting dynamically linked copies of the bundled native dependencies.

The source builder accepts `--libcurl=system` and `--libcurl=bundled`. With no flag it
keeps those platform defaults: system libcurl on macOS, bundled libcurl elsewhere.
`--libcurl=system` fails if `curl-sys` cannot discover a system libcurl instead of
allowing its normal bundled fallback. Both modes still use `curl-sys` for the Rust
FFI bindings.

## Release prebuilds

See [the prebuilds README](../prebuilds/README.md) for the release matrix and CI details.

Package consumers normally use platform-specific optional npm packages without
compilers or lifecycle scripts. The main package also includes the exact Rust
sources, Cargo.lock, and `build.mjs` for an explicit source build:

```text
npm exec --no -- sync-request-curl-build
pnpm exec sync-request-curl-build
yarn run sync-request-curl-build
```

See [Compatibility](../README.md#compatibility) for prerequisites, target
selection, and the distinction between prebuilt and best-effort source targets.
`build.mjs` runs on Node.js 16.17+ without npm dependencies, uses `cargo --locked`,
and load-checks the addon in a child Node.js process before replacing local output.
The repository's TypeScript wrapper adds the `--if-needed` freshness check.
All other repository automation under `scripts/` requires Node.js 24.14+ or 26+.
