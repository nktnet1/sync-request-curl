## Compatibility

`sync-request-curl` supports Node.js 16.17.0 and newer at runtime. The native addon targets Node-API v8, so a prebuilt addon is tied to its operating system, CPU architecture, and C runtime, but not to a specific Node.js major version. The same prebuilt binary can be reused by Node.js releases that support Node-API v8.

Repository build and release automation runs on newer Node.js versions independently of the published runtime requirement. The optional source-build entry point is plain JavaScript and runs on Node.js 16.17.0 or newer.

The published package does not download or compile native code during installation. Each release declares platform-specific optional packages, so the package manager installs only the native binary compatible with the current operating system, CPU architecture, and Linux C runtime. If optional dependencies are disabled or a matching package is unavailable, loading fails with an explicit error with instructions for an explicit source build. Compilation is never triggered by importing the library.

### Windows

Prebuilt addons are prepared for x64, arm64, and x86 (`ia32`) Windows. The x86 addon is built and load-checked with 32-bit Node.js 22. Use a Node.js release that provides an x86 runtime. No Visual Studio, Python, Rust, CMake, vcpkg, or node-gyp installation is required by package consumers.

Requests may still fail with Libcurl Error 60 (`CURLE_PEER_FAILED_VERIFICATION`) when the peer certificate cannot be verified. `rejectUnauthorized: false` disables origin certificate and hostname verification and should only be used when that trade-off is intentional.

### macOS

Prebuilt addons are prepared for Apple Silicon (`arm64`) and Intel (`x64`) macOS. No Xcode command-line tools or local libcurl installation is required by package consumers.

### Linux

Prebuilt addons are prepared for both glibc and musl on x64 and arm64 Linux. This covers the common Debian, Ubuntu, Arch, and Alpine variants without compiling native code during installation. GNU/Linux release binaries are built against a GLIBC 2.31 baseline, while Alpine binaries are built and tested in a musl environment.

### Building from source

The npm package includes the Rust addon sources and Cargo lockfile. If your
architecture has no prebuilt package, or you need a build for your local system,
install normally and explicitly compile the installed package:

```sh
npm install sync-request-curl --omit=optional
npx --no-install sync-request-curl-build
```

Run this with the same Node.js architecture that will use the library. This works
with installation scripts disabled and does not require node-gyp or development
JavaScript dependencies. Run the build command from your application directory.
There is no need to navigate into `node_modules`. `--no-install` prevents npx from downloading a
separate package if the local command is missing. With pnpm, use
`pnpm exec sync-request-curl-build`. Use `--help` to see the build prerequisites.
`--omit=optional` skips all optional dependencies for that npm installation.
Omit that flag if you want them installed. Rebuild after replacing or upgrading
the package. The command is explicit. Installation still runs no build hook.

Prerequisites:

- Rust 1.88 or newer and Cargo (rustup uses the included pinned toolchain).
- Linux/other Unix: a C/C++ compiler, make, Perl, and pkg-config. Install your
  distribution's development tools and CA certificates.
- macOS: Xcode Command Line Tools. The addon uses system libcurl.
- Windows: Visual Studio C++ Build Tools and Windows SDK for the target CPU.
  For x86, also install `rustup target add i686-pc-windows-msvc`.
- Access to the locked Cargo dependencies, or an already populated Cargo cache.

Linux builds bundle libcurl, HTTP/2, and OpenSSL. musl builds disable Rust's
static CRT mode so Node.js can load the shared addon. Source builds inherit the
local system's compatibility baseline, not the release prebuilds' GLIBC baseline.

The source builder does not restrict CPU architectures to the prebuilt matrix.
Additional Linux architectures (for example ARMv7, ppc64, s390x, and riscv64) and
other Unix platforms are best-effort: they need compatible Node.js, Rust, and
native dependencies and are not covered by release CI. A source-build route is
not a guarantee that every upstream dependency supports every target.

`CARGO_BUILD_TARGET` can select a Rust target when the Rust host differs from
Node.js (for example an ARMv7 ABI). Install that target and configure its C/linker
toolchain yourself. The builder must run on the destination system with matching
Node.js: it verifies the addon before installing it and is not a general-purpose
cross-compilation command. Windows defaults to the MSVC target matching Node.js.

The loader prefers `native/build/sync_request_curl_native.node` before detecting
prebuilt targets, including on unlisted architectures. For an externally managed
build, set `SYNC_REQUEST_CURL_NATIVE_PATH` to its absolute `.node` path. Invalid
local or explicitly selected binaries fail visibly rather than silently loading
a different binary. Normal prebuilt installations still require no build tools.

For repository development (Node.js 24.14+ or 26+), use:

```sh
pnpm build:native
pnpm test:source-build
pnpm test
```

`build:native` explicitly invokes Cargo even when a prebuild exists. The
source-build checks test orchestration and failure handling with mocked compiler
processes. `pnpm test` exercises the real addon, preferring the local build.
The build itself validates addon loading before installing the output. For a
standalone load check after compilation:

```sh
node scripts/verify-native-load.ts --file=native/build/sync_request_curl_native.node
```

For an installed package, run the source-build command shown above, then import
`sync-request-curl` normally. No environment override is needed. Keep the build
on the machine, architecture, and C runtime that will execute your application.
