import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const repository = resolve(import.meta.dirname, "../..");
const directories: string[] = [];

type MockOptions = {
  failChecksum?: boolean;
  failCargo?: boolean;
  failReadelf?: boolean;
};

const mockCommand = (directory: string, name: string, body: string): void => {
  writeFileSync(join(directory, name), `#!/bin/sh\nset -eu\n${body}\n`, {
    mode: 0o755,
  });
};

const createFixture = (): {
  root: string;
  bin: string;
  log: string;
  sysroot: string;
  addon: string;
} => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "freebsd-cross-test-")));
  directories.push(root);
  const bin = join(root, "bin");
  const scripts = join(root, "scripts");
  mkdirSync(bin);
  mkdirSync(scripts);
  mkdirSync(join(root, "native"));
  for (const name of [
    "freebsd-cross.sh",
    "freebsd-cross-cc.sh",
    "freebsd-cross-cxx.sh",
    "freebsd-cross-toolchain.cmake",
  ]) {
    copyFileSync(join(repository, "scripts", name), join(scripts, name));
  }
  const log = join(root, "commands.log");
  writeFileSync(log, "");
  const sysroot = join(root, "freebsd-14.4-arm64-sysroot");
  const addon = join(
    root,
    "prebuilds/sync_request_curl_native.freebsd-arm64.node",
  );

  mockCommand(
    bin,
    "curl",
    [
      'printf "curl %s\\n" "$*" >> "$LOG_FILE"',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "--output" ]; then shift; printf "mock-archive" > "$1"; break; fi',
      "  shift",
      "done",
    ].join("\n"),
  );
  mockCommand(
    bin,
    "sha256sum",
    [
      'cat >> "$LOG_FILE"',
      'if [ "$FAIL_CHECKSUM" = yes ]; then exit 1; fi',
    ].join("\n"),
  );
  mockCommand(
    bin,
    "tar",
    [
      'printf "tar %s\\n" "$*" >> "$LOG_FILE"',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-C" ]; then shift; break; fi',
      "  shift",
      "done",
      'mkdir -p "$1/usr/include/sys" "$1/usr/lib" "$1/lib"',
      'touch "$1/usr/include/sys/types.h" "$1/lib/libc.so.7"',
      'ln -s /lib/libc.so.7 "$1/usr/lib/libc.so"',
    ].join("\n"),
  );
  mockCommand(
    bin,
    "cargo",
    [
      'printf "cargo %s\\n" "$*" >> "$LOG_FILE"',
      'printf "target=%s\\n" "$CARGO_BUILD_TARGET" >> "$LOG_FILE"',
      'printf "CC=%s\\n" "$CC_aarch64_unknown_freebsd" >> "$LOG_FILE"',
      'printf "CXX=%s\\n" "$CXX_aarch64_unknown_freebsd" >> "$LOG_FILE"',
      'printf "linker=%s\\n" "$CARGO_TARGET_AARCH64_UNKNOWN_FREEBSD_LINKER" >> "$LOG_FILE"',
      'printf "cmake=%s\\n" "$CMAKE_TOOLCHAIN_FILE" >> "$LOG_FILE"',
      'printf "bindgen=%s\\n" "$BINDGEN_EXTRA_CLANG_ARGS" >> "$LOG_FILE"',
      'printf "openssl=%s libz=%s pkg=%s\\n" "$OPENSSL_STATIC" "$LIBZ_SYS_STATIC" "$PKG_CONFIG_ALL_STATIC" >> "$LOG_FILE"',
      'printf "pkg-config=%s %s %s\\n" "$PKG_CONFIG_ALLOW_CROSS" "$PKG_CONFIG_SYSROOT_DIR" "$PKG_CONFIG_LIBDIR" >> "$LOG_FILE"',
      'if [ "$FAIL_CARGO" = yes ]; then exit 1; fi',
      "mkdir -p native/target/aarch64-unknown-freebsd/release",
      'printf "arm64-native-addon" > native/target/aarch64-unknown-freebsd/release/libsync_request_curl_native.so',
    ].join("\n"),
  );
  mockCommand(
    bin,
    "readelf",
    [
      'printf "readelf %s\\n" "$*" >> "$LOG_FILE"',
      'if [ "$FAIL_READELF" = yes ]; then exit 1; fi',
      'printf "Type: DYN (Shared object file)\\nMachine: AArch64\\n"',
    ].join("\n"),
  );
  for (const compiler of ["clang-18", "clang++-18"]) {
    mockCommand(
      bin,
      compiler,
      `printf "${compiler} %s\\n" "$*" >> "$LOG_FILE"`,
    );
  }
  return { root, bin, log, sysroot, addon };
};

const execute = (
  fixture: ReturnType<typeof createFixture>,
  options: MockOptions = {},
  script = "freebsd-cross.sh",
) => {
  const result = spawnSync("sh", [join(fixture.root, "scripts", script)], {
    cwd: fixture.root,
    env: {
      ...process.env,
      HOME: fixture.root,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      LOG_FILE: fixture.log,
      RUNNER_TEMP: fixture.root,
      FREEBSD_CROSS_SYSROOT: fixture.sysroot,
      FAIL_CHECKSUM: options.failChecksum ? "yes" : "no",
      FAIL_CARGO: options.failCargo ? "yes" : "no",
      FAIL_READELF: options.failReadelf ? "yes" : "no",
    },
    encoding: "utf8",
  });
  return { ...result, log: readFileSync(fixture.log, "utf8") };
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cross-build uses the official 14.4 sysroot and keeps all bundled HTTP/3 features", () => {
  const fixture = createFixture();
  const result = execute(fixture);
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain(
    "https://download.freebsd.org/releases/arm64/14.4-RELEASE/base.txz",
  );
  expect(result.log).toContain(
    "c456bf75ee3d0b4da0b0b527402b0a9e61497f02756b2cc5801b51e80b3f90c4",
  );
  expect(result.log).toContain(
    "cargo build --locked --manifest-path native/Cargo.toml --release --target aarch64-unknown-freebsd --no-default-features --features bundled-curl-http3",
  );
  expect(result.log).toContain("target=aarch64-unknown-freebsd");
  expect(result.log).toContain(
    `CC=${join(fixture.root, "scripts/freebsd-cross-cc.sh")}`,
  );
  expect(result.log).toContain(
    `CXX=${join(fixture.root, "scripts/freebsd-cross-cxx.sh")}`,
  );
  expect(result.log).toContain(
    `linker=${join(fixture.root, "scripts/freebsd-cross-cc.sh")}`,
  );
  expect(result.log).toContain(
    `cmake=${join(fixture.root, "scripts/freebsd-cross-toolchain.cmake")}`,
  );
  expect(result.log).toContain(
    `bindgen=--target=aarch64-unknown-freebsd14.4 --sysroot=${fixture.sysroot}`,
  );
  expect(result.log).toContain("openssl=1 libz=1 pkg=1");
  expect(result.log).toContain(
    `pkg-config=1 ${fixture.sysroot} ${fixture.sysroot}/usr/libdata/pkgconfig:${fixture.sysroot}/usr/lib/pkgconfig`,
  );
  expect(readFileSync(fixture.addon, "utf8")).toBe("arm64-native-addon");
  expect(readFileSync(join(fixture.sysroot, "usr/lib/libc.so"), "utf8")).toBe(
    "",
  );
});

test("reuses an already verified sysroot without fetching it again", () => {
  const fixture = createFixture();
  expect(execute(fixture).status).toBe(0);
  writeFileSync(fixture.log, "");
  const again = execute(fixture);
  expect(again.status, again.stderr + again.log).toBe(0);
  expect(again.log).not.toContain("curl ");
  expect(again.log).not.toContain("tar ");
  expect(again.log).toContain("cargo build");
});

test("refuses an unverified FreeBSD sysroot", () => {
  const fixture = createFixture();
  const result = execute(fixture, { failChecksum: true });
  expect(result.status).not.toBe(0);
  expect(result.log).not.toContain("tar ");
  expect(result.log).not.toContain("cargo ");
  expect(existsSync(join(fixture.sysroot, ".complete"))).toBe(false);
});

test("does not publish a partial addon when compilation fails", () => {
  const fixture = createFixture();
  const result = execute(fixture, { failCargo: true });
  expect(result.status).not.toBe(0);
  expect(result.log).toContain("cargo build");
  expect(existsSync(fixture.addon)).toBe(false);
});

test("does not stage an addon that is not a FreeBSD ARM64 shared library", () => {
  const fixture = createFixture();
  const result = execute(fixture, { failReadelf: true });
  expect(result.status).not.toBe(0);
  expect(result.log).toContain("readelf");
  expect(existsSync(fixture.addon)).toBe(false);
});

test.each([
  ["freebsd-cross-cc.sh", "clang-18"],
  ["freebsd-cross-cxx.sh", "clang++-18"],
])("%s targets FreeBSD instead of the Linux host", (script, compiler) => {
  const fixture = createFixture();
  const result = execute(fixture, {}, script);
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain(
    `${compiler} --target=aarch64-unknown-freebsd14.4 --sysroot=${fixture.sysroot} -fuse-ld=lld`,
  );
});

test.each([
  ["freebsd-cross-cc.sh", "clang-18"],
  ["freebsd-cross-cxx.sh", "clang++-18"],
])("%s does not pass link-only flags to compilation", (script, compiler) => {
  const fixture = createFixture();
  const result = spawnSync(
    "sh",
    [join(fixture.root, "scripts", script), "-c", "example.c"],
    {
      env: {
        ...process.env,
        PATH: `${fixture.bin}:${process.env.PATH}`,
        LOG_FILE: fixture.log,
        FREEBSD_CROSS_SYSROOT: fixture.sysroot,
      },
      encoding: "utf8",
    },
  );
  const log = readFileSync(fixture.log, "utf8");
  expect(result.status, result.stderr + log).toBe(0);
  expect(log).toContain(
    `${compiler} --target=aarch64-unknown-freebsd14.4 --sysroot=${fixture.sysroot} -c example.c`,
  );
  expect(log).not.toContain("-fuse-ld=lld");
});
