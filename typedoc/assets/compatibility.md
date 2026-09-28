## Compatibility

`sync-request-curl` supports Node.js 16.17.0 and newer.

The package manager selects a matching native binary when one is available.
Installing or importing the package does not compile native code.

### Windows

Prebuilt binaries are available for x64, arm64, and x86 (`ia32`) Windows. For
x86, use a Node.js release that provides an x86 runtime.

Requests can fail with Libcurl Error 60 (`CURLE_PEER_FAILED_VERIFICATION`) when
the peer certificate cannot be verified. `rejectUnauthorized: false` disables
origin certificate and hostname verification and should only be used when that
trade-off is intentional.

### macOS

Prebuilt binaries are available for Apple Silicon (`arm64`) and Intel (`x64`) macOS.

### Linux

Prebuilt binaries are available for x64 and arm64 Linux on both glibc and musl.
GNU/Linux release binaries require GLIBC 2.31 or newer.

### Building from source

If a prebuilt binary is unavailable for your platform, or if optional
dependencies were intentionally omitted, build the installed package explicitly
using your package manager:

```text
npm exec --no -- sync-request-curl-build
pnpm exec sync-request-curl-build
yarn run sync-request-curl-build
```

Run the build with the same Node.js architecture that will use the library. Run
`sync-request-curl-build --help` for the current prerequisites.

Source builds keep the release defaults: macOS links the system libcurl, while
Linux and Windows build the libcurl bundled by `curl-sys`. Override that choice
explicitly when needed:

```sh
npm exec --no -- sync-request-curl-build --libcurl=system
npm exec --no -- sync-request-curl-build --libcurl=bundled
```

`--libcurl=system` is strict: if `curl-sys` cannot discover a compatible system
libcurl, the build fails instead of silently falling back to its bundled copy.
On Unix systems, system discovery uses the platform libcurl or `pkg-config`.
On Windows, `curl-sys` uses vcpkg. System builds inherit the capabilities and
TLS behaviour of the selected libcurl. `--libcurl=bundled` uses the pinned libcurl
shipped by `curl-sys` and retains the package's vendored build configuration.
The flag selects the libcurl implementation. Both modes continue to use
`curl-sys` as the Rust FFI layer.

Source builds require:

- Rust 1.88 or newer and Cargo
- Linux and other Unix systems: a C/C++ compiler, make, Perl, pkg-config, and
  CA certificates
- macOS: Xcode Command Line Tools
- Windows: Visual Studio C++ Build Tools and the Windows SDK for the target CPU
- Access to the locked Cargo dependencies, or an already populated Cargo cache

Other architectures and Unix platforms may work when Node.js, Rust, and the
required native dependencies support them, but they are not part of the
prebuilt release matrix.

Set `CARGO_BUILD_TARGET` when you need to select a Rust target explicitly. The
build must still run with a Node.js architecture compatible with the resulting
addon.

To use an externally managed native build, set `SYNC_REQUEST_CURL_NATIVE_PATH`
to the absolute path of its `.node` file.
