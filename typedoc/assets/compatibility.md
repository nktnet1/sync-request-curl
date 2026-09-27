## Compatibility

`sync-request-curl` supports Node.js 16.17.0 and newer at runtime. The native addon targets Node-API v8, so a prebuilt addon is tied to its operating system, CPU architecture, and C runtime, but not to a specific Node.js major version. The same prebuilt binary can be reused by Node.js releases that support Node-API v8.

Repository build and release automation runs on newer Node.js versions independently of the published runtime requirement. Package consumers do not execute those TypeScript build scripts or compile the native addon.

The published package does not download or compile native code during installation. Each release declares platform-specific optional packages, so the package manager installs only the native binary compatible with the current operating system, CPU architecture, and Linux C runtime. If optional dependencies are disabled or a matching package is unavailable, loading fails with an explicit error instead of falling back to `node-gyp`.

### Windows

Prebuilt addons are prepared for x64 and arm64 Windows. No Visual Studio, Python, Rust, CMake, vcpkg, or node-gyp installation is required by package consumers.

Requests may still fail with Libcurl Error 60 (`CURLE_PEER_FAILED_VERIFICATION`) when the peer certificate cannot be verified. `rejectUnauthorized: false` disables origin certificate and hostname verification and should only be used when that trade-off is intentional.

### macOS

Prebuilt addons are prepared for Apple Silicon (`arm64`) and Intel (`x64`) macOS. No Xcode command-line tools or local libcurl installation is required by package consumers.

### Linux

Prebuilt addons are prepared for both glibc and musl on x64 and arm64 Linux. This covers the common Debian, Ubuntu, Arch, and Alpine variants without compiling native code during installation. GNU/Linux release binaries are built against a GLIBC 2.31 baseline, while Alpine binaries are built and tested in a musl environment.
