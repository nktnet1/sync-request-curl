# Repository automation

Scripts are grouped by purpose and run from the repository root.

- `build/`: native builds, prebuild staging, platform and toolchain checks, and addon verification
- `build/freebsd/`: FreeBSD VM preparation, native verification, and ARM64 cross-compilation
- `release/`: versioning, package preparation, registry checks, and publication
- `test/`: local test and Verdaccio helpers
- `shared/`: reusable process execution helpers

Most automation uses TypeScript and runs with Node.js 24.14+ or 26+.

The FreeBSD directory retains three small shell files for toolchain integration. `prepare.sh` installs Node and the build tools in a fresh FreeBSD VM, so it cannot rely on TypeScript yet. `cc.sh` and `cxx.sh` are compiler shims invoked many times by native dependency builds, where starting a Node process per compiler invocation would add significant overhead. Cross-build orchestration and all post-bootstrap FreeBSD build and verification commands are implemented in TypeScript.

`toolchain.cmake` is consumed directly by CMake and is not a standalone script.
