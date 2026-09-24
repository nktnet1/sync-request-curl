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

`curl-sys` builds libcurl from its bundled source with HTTP/2 enabled. Unix TLS
uses vendored OpenSSL; Windows uses Schannel. zlib and the Linux GCC runtime are
forced static in the prebuild path so release binaries do not acquire accidental
runtime dependencies on build-host libraries.

## Release prebuilds

See [the prebuilds README](../prebuilds/README.md) for the release matrix and CI details.

Package consumers never compile this directory. Release CI publishes each generated
`.node` file in a platform-specific optional npm package, so installation does
not require Rust, a C/C++ compiler, CMake, vcpkg, node-gyp, or lifecycle-script
approval.

All repository automation under `scripts/` is TypeScript and runs directly in
Node.js. Local development with those scripts requires a Node.js release where
type stripping is enabled by default; `scripts/` is not included in the npm
package and does not change the published library runtime requirement.
