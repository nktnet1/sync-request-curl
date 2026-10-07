# Native prebuilds

Release CI builds one Node-API addon for each supported platform and places the
finished artifacts alongside this file in the repository-level `prebuilds/`
directory. The publish workflow repackages each `.node` artifact into its own
platform-specific optional npm package, while the public entry point remains
`sync-request-curl`. This README documents the supported matrix, naming, and
verification.

The release matrix contains:

- macOS x64 and arm64
- Windows x64, arm64, and x86 (ia32)
- Linux x64 and arm64 with glibc
- Linux x64 and arm64 with musl

Alpine consumes the musl builds. Debian, Ubuntu, Arch, and other glibc
distributions consume the GNU builds.

Linux prebuilds are produced inside pinned Node container families. GNU builds
use the archived Debian Bullseye package snapshot and are checked for a GLIBC
2.31-or-older requirement. musl builds are produced in Alpine and are also
loaded and tested in Alpine containers.

Desktop builds run Cargo on GitHub runners. Windows x86 builds target
`i686-pc-windows-msvc` and are load-checked with 32-bit Node.js 22. Linux build
containers install the pinned Rust 1.96 toolchain before compiling. The Cargo
build bundles libcurl and its build-time native dependencies into the addon, after which CI
stages the dynamic library as:

```text
prebuilds/sync_request_curl_native.<platform>.node
```

`pnpm verify:prebuilds` checks that the complete nine-binary release matrix is
present before packaging. `pnpm prepare:release-packages` then creates the main
package plus nine `@nktnet/sync-request-curl-<platform>` packages under
`.release/`. The main package declares those packages as exact-version optional
dependencies; npm-compatible package managers use each companion package's `os`,
`cpu`, and (on Linux) `libc` metadata to install only the matching binary.
