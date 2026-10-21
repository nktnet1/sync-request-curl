#!/bin/sh
set -eu

rust_toolchain() {
  case "$(uname -m)" in
    amd64) node scripts/rust-toolchain.ts ;;
    arm64) printf '1.98.1\n' ;;
    *) echo "Unsupported FreeBSD architecture: $(uname -m)" >&2; exit 1 ;;
  esac
}

prepare() {
  set -x
  pkg install -y node24 cmake gmake pkgconf perl5 llvm

  case "$(uname -m)" in
    amd64)
      pkg install -y rustup-init
      rustup-init -y --no-modify-path --default-toolchain none --profile minimal
      ;;
    arm64)
      # The FreeBSD rustup-init port is only packaged for amd64.
      installer="$(mktemp /tmp/rustup-init.XXXXXXXX)"
      trap 'rm -f "$installer" "$installer.sha256"' EXIT
      url=https://static.rust-lang.org/rustup/dist/aarch64-unknown-freebsd/rustup-init
      fetch -o "$installer" "$url"
      fetch -o "$installer.sha256" "$url.sha256"
      expected="$(awk 'NR == 1 {print $1}' "$installer.sha256")"
      actual="$(sha256 -q "$installer")"
      if [ "$actual" != "$expected" ]; then
        echo "Rustup installer SHA-256 verification failed" >&2
        exit 1
      fi
      chmod +x "$installer"
      "$installer" -y --no-modify-path --default-toolchain none --profile minimal
      ;;
    *) echo "Unsupported FreeBSD architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"
  rustup toolchain install "$(rust_toolchain)" --profile minimal --no-self-update
}

build() {
  platform="${1:?Expected native platform key}"
  set -x
  export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"
  export RUSTUP_TOOLCHAIN="$(rust_toolchain)"
  for directory in /usr/local/llvm*/lib; do
    if [ -f "$directory/libclang.so" ]; then
      export LIBCLANG_PATH="$directory"
      break
    fi
  done
  test "$(node -p 'process.platform + "-" + process.arch')" = "$platform"
  test "$(rustc --version | awk '{print $2}')" = "$RUSTUP_TOOLCHAIN"
  node scripts/build-native.ts
  node scripts/stage-native.ts "--platform=$platform"
  node scripts/verify-native-load.ts "--file=prebuilds/sync_request_curl_native.$platform.node"
  node scripts/verify-native-http.ts "--file=prebuilds/sync_request_curl_native.$platform.node"
  if ldd "prebuilds/sync_request_curl_native.$platform.node" | grep -q '/usr/local/'; then
    echo "FreeBSD addon has unexpected runtime dependencies under /usr/local" >&2
    exit 1
  fi
  rm -rf native/target native/build
}

case "${1:-}" in
  prepare) prepare ;;
  build) build "${2:-}" ;;
  *) echo "Usage: sh scripts/freebsd-ci.sh prepare|build [freebsd-x64|freebsd-arm64]" >&2; exit 2 ;;
esac
