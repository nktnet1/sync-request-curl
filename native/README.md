# Native addon

`addon.cc` is a deliberately small synchronous Node-API wrapper around
libcurl. It targets Node-API v8 and does not include V8 or Node internal APIs,
so the compiled addon is ABI-stable across Node.js releases that support that
Node-API version.

The Node-API C headers are vendored in `node-api/` for build-time use only.
Consumers never compile this directory.

## Building locally

Local development does not require CMake on macOS or Linux:

```sh
pnpm build:native
pnpm test
```

`pnpm test` automatically builds the local addon when it is missing or older
than the native sources.

On macOS the local build uses the Xcode Command Line Tools (`xcrun clang++`)
and the libcurl shipped in the macOS SDK. If the command line tools are not
installed, run `xcode-select --install`.

On Linux the local build needs a C++17 compiler plus libcurl development files.
It discovers libcurl through `pkg-config` first and `curl-config` second. For
example, Debian/Ubuntu development packages can be installed with:

```sh
sudo apt install g++ libcurl4-openssl-dev pkg-config
```

Local builds are for development/testing only and may dynamically link the
host libcurl. Package consumers never use this path.

## Release prebuilds

Release binaries continue to use the reproducible CMake + vcpkg path:

```sh
pnpm build:native:cmake
pnpm stage:native
```

The GitHub Actions native-prebuild workflow builds static libcurl with vcpkg
and produces the six release binaries checked by `pnpm verify:prebuilds`.
Those `.node` files are shipped in the npm package, so consumers do not need a
compiler, CMake, vcpkg, node-gyp, or lifecycle-script approval.

Windows local builds currently use this CMake path as well. Windows additionally
needs a `node.lib` import library while linking. Release CI downloads it for the
Node version used to build the addon; it is not part of the runtime package and
does not tie the resulting addon to that Node version.
