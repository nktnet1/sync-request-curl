#!/bin/sh
set -eu

rust_toolchain() {
  # Read the repository minimum without running Node (which may not be installed yet).
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
}

rust_version_at_least() {
  awk -v found="$1" -v required="$2" 'BEGIN {
    if (found !~ /^[0-9]+\.[0-9]+\.[0-9]+$/ || required !~ /^[0-9]+\.[0-9]+\.[0-9]+$/) exit 1
    split(found, actual, ".")
    split(required, minimum, ".")
    for (i = 1; i <= 3; i++) {
      if (actual[i] + 0 > minimum[i] + 0) exit 0
      if (actual[i] + 0 < minimum[i] + 0) exit 1
    }
    exit 0
  }'
}

check_arm64_rust() {
  required="$(rust_toolchain)" || return 1
  installed="$(rustc --version | awk '{ print $2 }')" || return 1
  if ! rust_version_at_least "$installed" "$required"; then
    printf 'FreeBSD arm64 requires Rust %s or newer; found %s\n' "$required" "$installed" >&2
    return 1
  fi
  printf 'FreeBSD arm64 Rust %s meets minimum %s\n' "$installed" "$required" >&2
}

prepare() {
  set -x
  arch="$(uname -m)"
  phase="initialisation"
  on_prepare_exit() {
    status="$1"
    if [ "$status" -ne 0 ]; then
      printf 'FreeBSD %s preparation failed during %s (exit %s)\n' "$arch" "$phase" "$status" >&2
    fi
  }
  trap 'on_prepare_exit "$?"' 0

  printf 'Preparing FreeBSD %s native build environment\n' "$arch" >&2
  if [ "$arch" = arm64 ]; then
    # ARM64 VM images may ship an outdated or unbootstrapped pkg database.
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

  export PATH="$HOME/.cargo/bin:$PATH:/usr/local/bin"
  case "$arch" in
    amd64)
      phase="rustup package installation"
      pkg install -y rustup-init
      phase="rustup initialisation"
      rustup-init -y --no-modify-path --default-toolchain none --profile minimal
      phase="Rust toolchain selection"
      toolchain="$(rust_toolchain)" || return 1
      printf 'Installing Rust toolchain %s\n' "$toolchain" >&2
      phase="Rust toolchain installation"
      if ! rustup toolchain install "$toolchain" --profile minimal --no-self-update; then
        echo "Failed to install Rust toolchain $toolchain on FreeBSD $arch" >&2
        return 1
      fi
      ;;
    arm64)
      # The rustup-init download is not published for FreeBSD ARM64. Use the
      # native compiler from FreeBSD packages and check its version instead.
      phase="FreeBSD Rust package installation"
      if ! env ASSUME_ALWAYS_YES=YES pkg install -y rust; then
        echo "Failed to install FreeBSD arm64 Rust package" >&2
        return 1
      fi
      phase="Rust version verification"
      check_arm64_rust || return 1
      ;;
    *) echo "Unsupported FreeBSD architecture: $arch" >&2; return 1 ;;
  esac
}

build() {
  platform="${1:?Expected native platform key}"
  set -x
  export PATH="$HOME/.cargo/bin:$PATH:/usr/local/bin"
  case "$(uname -m)" in
    amd64)
      RUSTUP_TOOLCHAIN="$(rust_toolchain)" || return 1
      export RUSTUP_TOOLCHAIN
      test "$(rustc --version | awk '{print $2}')" = "$RUSTUP_TOOLCHAIN"
      ;;
    arm64)
      # The FreeBSD package supplies rustc and cargo without rustup.
      unset RUSTUP_TOOLCHAIN
      check_arm64_rust || return 1
      ;;
    *) echo "Unsupported FreeBSD architecture: $(uname -m)" >&2; return 1 ;;
  esac
  for directory in /usr/local/llvm*/lib; do
    if [ -f "$directory/libclang.so" ]; then
      export LIBCLANG_PATH="$directory"
      break
    fi
  done
  test "$(node -p 'process.platform + "-" + process.arch')" = "$platform"
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
