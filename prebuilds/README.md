# Native prebuilds

Release CI places one Node-API addon per supported platform in this directory.
The published `sync-request-curl` package ships these files directly, so npm
installation never runs a native build or a binary download script.

The release matrix contains x64 and arm64 builds for macOS and Windows, plus
both glibc and musl variants for x64 and arm64 Linux. Alpine consumes the musl
builds; Debian, Ubuntu, Arch, and other glibc distributions consume the GNU
builds.
