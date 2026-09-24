# Native prebuilds

Release CI builds one Node-API addon for each supported platform and places the
finished artifacts alongside this file in the repository-level `prebuilds/`
directory. The `.node` files are generated release artifacts; this README
documents their supported matrix, naming, and verification.

The release matrix contains:

- macOS x64 and arm64
- Windows x64 and arm64
- Linux x64 and arm64 with glibc
- Linux x64 and arm64 with musl

Alpine consumes the musl builds. Debian, Ubuntu, Arch, and other glibc
distributions consume the GNU builds.

Linux prebuilds are produced inside pinned Node container families. GNU builds
use the archived Debian Bullseye package snapshot and are checked for a GLIBC
2.31-or-older requirement. musl builds are produced in Alpine and are also
loaded and tested in Alpine containers.

Desktop builds run Cargo directly on the matching GitHub runner. Linux build
containers install the pinned Rust 1.88 toolchain before compiling. The Cargo
build bundles libcurl and its build-time native dependencies into the addon, after which CI
stages the dynamic library as:

```text
prebuilds/sync_request_curl_native.<platform>.node
```

`pnpm verify:prebuilds` checks that the complete eight-binary release matrix is
present before packaging.
