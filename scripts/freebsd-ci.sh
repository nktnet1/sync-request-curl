#!/bin/sh
set -eu

rust_toolchain() {
  case "$(uname -m)" in
    amd64)
      # Read the pin without running Node (which may not be installed yet).
      if [ ! -f rust-toolchain.toml ]; then
        echo "Missing rust-toolchain.toml" >&2
        return 1
      fi
      version="$(awk -F '"' '/^[[:space:]]*channel[[:space:]]*=/ { print $2; exit }' rust-toolchain.toml)"
      if [ -z "$version" ]; then
        echo "Missing Rust channel in rust-toolchain.toml" >&2
        return 1
      fi
      printf '%s\n' "$version"
      ;;
    arm64) printf '1.98.1\n' ;;
    *) echo "Unsupported FreeBSD architecture: $(uname -m)" >&2; return 1 ;;
  esac
}

prepare() {
  set -x
  arch="$(uname -m)"
  phase="initialisation"
  installer=""
  on_prepare_exit() {
    status="$1"
    if [ -n "$installer" ]; then
      rm -f "$installer" "$installer.sha256"
    fi
    if [ "$status" -ne 0 ]; then
      printf 'FreeBSD %s preparation failed during %s (exit %s)\n' "$arch" "$phase" "$status" >&2
    fi
  }
  trap 'on_prepare_exit "$?"' 0

  printf 'Preparing FreeBSD %s native build environment\n' "$arch" >&2
  if [ "$arch" = arm64 ]; then
    # ARM64 VM images may ship an outdated or unbootstrapped pkg database.
    # Re-bootstrap before requesting the ports repository catalogue.
    phase="pkg bootstrap"
    env ASSUME_ALWAYS_YES=YES pkg bootstrap -f
    phase="pkg repository update"
    env ASSUME_ALWAYS_YES=YES pkg update -f
  fi

  phase="dependency installation"
  if ! env ASSUME_ALWAYS_YES=YES pkg install -y node24 cmake gmake pkgconf perl5 llvm ca_root_nss; then
    echo "FreeBSD dependency installation failed (pkg)" >&2
    return 1
  fi

  case "$arch" in
    amd64)
      phase="rustup package installation"
      pkg install -y rustup-init
      phase="rustup initialisation"
      rustup-init -y --no-modify-path --default-toolchain none --profile minimal
      ;;
    arm64)
      # The FreeBSD rustup-init port is only packaged for amd64.
      phase="rustup download"
      installer="$(mktemp /tmp/rustup-init.XXXXXXXX)"
      url=https://static.rust-lang.org/rustup/dist/aarch64-unknown-freebsd/rustup-init
      fetch -o "$installer" "$url"
      fetch -o "$installer.sha256" "$url.sha256"
      phase="rustup checksum verification"
      expected="$(awk 'NR == 1 {print $1}' "$installer.sha256")"
      actual="$(sha256 -q "$installer")"
      if [ "$actual" != "$expected" ]; then
        echo "Rustup installer SHA-256 verification failed" >&2
        return 1
      fi
      phase="rustup initialisation"
      chmod +x "$installer"
      "$installer" -y --no-modify-path --default-toolchain none --profile minimal
      ;;
    *) echo "Unsupported FreeBSD architecture: $arch" >&2; return 1 ;;
  esac

  export PATH="$HOME/.cargo/bin:$PATH:/usr/local/bin"
  phase="Rust toolchain selection"
  toolchain="$(rust_toolchain)" || return 1
  printf 'Installing Rust toolchain %s\n' "$toolchain" >&2
  phase="Rust toolchain installation"
  if ! rustup toolchain install "$toolchain" --profile minimal --no-self-update; then
    echo "Failed to install Rust toolchain $toolchain on FreeBSD $arch" >&2
    return 1
  fi
}

build() {
  platform="${1:?Expected native platform key}"
  set -x
  export PATH="$HOME/.cargo/bin:$PATH:/usr/local/bin"
  RUSTUP_TOOLCHAIN="$(rust_toolchain)" || return 1
  export RUSTUP_TOOLCHAIN
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
