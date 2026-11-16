#!/bin/sh
set -eu
: "${FREEBSD_CROSS_SYSROOT:?Missing FreeBSD ARM64 sysroot}"
for argument do
  case "$argument" in
    -c|-E|-S)
      exec clang++-18 --target=aarch64-unknown-freebsd14.4 \
        "--sysroot=$FREEBSD_CROSS_SYSROOT" "$@"
      ;;
    *)
      :
      ;;
  esac
done
exec clang++-18 --target=aarch64-unknown-freebsd14.4 \
  "--sysroot=$FREEBSD_CROSS_SYSROOT" -fuse-ld=lld "$@"
