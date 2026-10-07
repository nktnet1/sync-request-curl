# Native addon

The native addon is a synchronous Rust Node-API wrapper around libcurl. It uses
`napi-rs` with Node-API v8, so release binaries are tied to the operating system,
CPU architecture, and C runtime rather than to a specific Node.js major.

The Rust layer intentionally keeps libcurl underneath the public API. That
preserves curl error codes and the existing proxy, TLS, interface, DNS,
keepalive, raw-body, and multipart behaviour instead of changing HTTP stacks as
part of the language migration.

## Building locally

Local native builds require the Rust toolchain pinned by `../rust-toolchain.toml`,
Node.js, CMake 3.20+, and the platform C/C++ toolchain used by the bundled libcurl/AWS-LC build (Xcode Command Line Tools,
MSVC Build Tools, or a Linux build-essential equivalent). Linux builds also need
libclang for bindgen, and Windows x86/x64 builds need NASM:

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

`curl-sys` builds bundled libcurl with HTTP/2 and HTTP/3 on all prebuilt release
targets. HTTP/3 uses ngtcp2 and nghttp3 with AWS-LC as libcurl's TLS backend.
macOS additionally enables Apple SecTrust for native certificate verification, and
Windows uses the native CA store. System/custom libcurl builds can use
`httpVersion: "3"` or `"3-only"` only when that linked libcurl reports HTTP/3
support. zlib is forced static in the prebuild path. The Linux GCC
unwinding runtime (`libgcc_s`) may
remain dynamically linked; the dependency verifier permits this platform runtime
while rejecting dynamically linked copies of the bundled native dependencies.

The bundled libcurl supports TCP keepalive probe counts. System libcurl builds
need libcurl 8.9.0 or newer for `tcpKeepAlive.probeCount`, and the active
platform must implement the option. Unsupported linked libcurl/platform
combinations return a clear transport error instead of silently ignoring it.

The source builder accepts `--libcurl=system` and `--libcurl=bundled`. With no flag it
uses bundled libcurl on all supported platforms. On macOS, the bundled build uses
Apple SecTrust for native certificate verification.
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
