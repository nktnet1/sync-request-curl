#!/bin/sh
set -eu

# Cross-compile on Linux with LLVM and the official FreeBSD 14.4 ARM64 sysroot.
# Keep the existing FreeBSD VM as the authority for loading and testing the addon.
release=14.4
target=aarch64-unknown-freebsd
sysroot="${FREEBSD_CROSS_SYSROOT:-${RUNNER_TEMP:-/tmp}/freebsd-${release}-arm64-sysroot}"
root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"

if [ ! -f "$sysroot/.complete" ]; then
  archive="$(mktemp "${TMPDIR:-/tmp}/freebsd-arm64-base.XXXXXX.txz")"
  trap 'rm -f "$archive"' 0
  mkdir -p "$sysroot"
  curl --fail --location --retry 3 --silent --show-error \
    --output "$archive" \
    "https://download.freebsd.org/releases/arm64/${release}-RELEASE/base.txz"
  # SHA256 from the FreeBSD 14.4-RELEASE arm64 MANIFEST.
  printf '%s  %s\n' \
    'c456bf75ee3d0b4da0b0b527402b0a9e61497f02756b2cc5801b51e80b3f90c4' \
    "$archive" | sha256sum --check --status -
  tar -xJf "$archive" -C "$sysroot"
  test -f "$sysroot/usr/include/sys/types.h"
  test -d "$sysroot/usr/lib"

  # Resolve absolute FreeBSD symlinks within the sysroot, not on the Linux host.
  find "$sysroot" -type l | while IFS= read -r link; do
    destination="$(readlink "$link")"
    case "$destination" in
      /*) ln -sfn "$(realpath -m --relative-to="$(dirname "$link")" "$sysroot$destination")" "$link" ;;
    esac
  done
  touch "$sysroot/.complete"
  rm -f "$archive"
  trap - 0
fi

export FREEBSD_CROSS_SYSROOT="$sysroot"
export CARGO_BUILD_TARGET="$target"
export CARGO_TARGET_AARCH64_UNKNOWN_FREEBSD_LINKER="$root/scripts/freebsd-cross-cc.sh"
export CC_aarch64_unknown_freebsd="$root/scripts/freebsd-cross-cc.sh"
export CXX_aarch64_unknown_freebsd="$root/scripts/freebsd-cross-cxx.sh"
export AR_aarch64_unknown_freebsd=llvm-ar-18
export RANLIB_aarch64_unknown_freebsd=llvm-ranlib-18
export AR=llvm-ar-18
export RANLIB=llvm-ranlib-18
export CMAKE_TOOLCHAIN_FILE="$root/scripts/freebsd-cross-toolchain.cmake"
export LIBCLANG_PATH=/usr/lib/llvm-18/lib
export BINDGEN_EXTRA_CLANG_ARGS="--target=aarch64-unknown-freebsd${release} --sysroot=$sysroot"
export LIBZ_SYS_STATIC=1
export OPENSSL_STATIC=1
export PKG_CONFIG_ALL_STATIC=1
# Never discover Linux host libraries through pkg-config during cross builds.
export PKG_CONFIG_ALLOW_CROSS=1
export PKG_CONFIG_SYSROOT_DIR="$sysroot"
export PKG_CONFIG_LIBDIR="$sysroot/usr/libdata/pkgconfig:$sysroot/usr/lib/pkgconfig"

cd "$root"
cargo build --locked --manifest-path native/Cargo.toml --release \
  --target "$target" --no-default-features --features bundled-curl-http3

library="native/target/$target/release/libsync_request_curl_native.so"
readelf -h "$library" | grep -Eq 'Type:[[:space:]]+DYN'
readelf -h "$library" | grep -Eq 'Machine:[[:space:]]+AArch64'
mkdir -p prebuilds
cp "$library" prebuilds/sync_request_curl_native.freebsd-arm64.node
