import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const script = resolve(import.meta.dirname, "../../scripts/freebsd-ci.sh");
const directories: string[] = [];

const runFreebsdScript = (
  arch: "amd64" | "arm64" | "other",
  command: "prepare" | "build",
  options: { badDigest?: boolean } = {},
) => {
  const root = mkdtempSync(join(tmpdir(), "freebsd-ci-test-"));
  directories.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "commands.log");
  writeFileSync(log, "");

  const mock = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  mock("uname", 'printf "%s\\n" "$FAKE_ARCH"');
  mock("pkg", 'printf "pkg %s\\n" "$*" >> "$LOG_FILE"');
  mock(
    "node",
    [
      'if [ "$1" = "-p" ]; then',
      '  printf "freebsd-%s\\n" "$FAKE_NODE_ARCH"',
      'elif [ "$1" = "scripts/rust-toolchain.ts" ]; then',
      '  printf "1.96.0\\n"',
      "else",
      '  printf "node %s toolchain=%s\\n" "$*" "$RUSTUP_TOOLCHAIN" >> "$LOG_FILE"',
      "fi",
    ].join("\n"),
  );
  mock("rustup-init", 'printf "rustup-init %s\\n" "$*" >> "$LOG_FILE"');
  mock("rustup", 'printf "rustup %s\\n" "$*" >> "$LOG_FILE"');
  mock(
    "fetch",
    [
      'file="$2"',
      'case "$file" in',
      '  *.sha256) printf "fixture-digest  rustup-init\\n" > "$file" ;;',
      '  *) printf \'#!/bin/sh\\nprintf "downloaded-rustup %%s\\\\n" "$*" >> "$LOG_FILE"\\n\' > "$file" ;;',
      "esac",
    ].join("\n"),
  );
  mock(
    "sha256",
    'if [ "$BAD_DIGEST" = "yes" ]; then echo incorrect; else echo fixture-digest; fi',
  );
  mock("rustc", 'printf "rustc %s (mock)\\n" "$FAKE_RUST_VERSION"');
  mock("ldd", 'printf "libc.so.7 => /lib/libc.so.7\\n"');

  const result = spawnSync(
    "sh",
    [script, command, `freebsd-${arch === "amd64" ? "x64" : "arm64"}`],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        LOG_FILE: log,
        FAKE_ARCH: arch,
        FAKE_NODE_ARCH: arch === "amd64" ? "x64" : "arm64",
        FAKE_RUST_VERSION: arch === "arm64" ? "1.98.1" : "1.96.0",
        BAD_DIGEST: options.badDigest ? "yes" : "no",
      },
      encoding: "utf8",
    },
  );

  return { ...result, log: readFileSync(log, "utf8") };
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("FreeBSD x64 uses the packaged installer and pinned toolchain", () => {
  const result = runFreebsdScript("amd64", "prepare");
  expect(result.status).toBe(0);
  expect(result.log).toContain("pkg install -y rustup-init");
  expect(result.log).toContain("rustup-init -y --no-modify-path");
  expect(result.log).toContain("rustup toolchain install 1.96.0");
  expect(result.log).not.toContain("downloaded-rustup");
});

test("FreeBSD arm64 uses the verified official installer and newer toolchain", () => {
  const result = runFreebsdScript("arm64", "prepare");
  expect(result.status).toBe(0);
  expect(result.log).not.toContain("pkg install -y rustup-init");
  expect(result.log).toContain("downloaded-rustup -y --no-modify-path");
  expect(result.log).toContain("rustup toolchain install 1.98.1");
});

test("FreeBSD arm64 refuses an installer with a bad checksum", () => {
  const result = runFreebsdScript("arm64", "prepare", { badDigest: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("SHA-256 verification failed");
  expect(result.log).not.toContain("downloaded-rustup");
});

test("FreeBSD CI rejects unsupported host architectures", () => {
  const result = runFreebsdScript("other", "prepare");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unsupported FreeBSD architecture: other");
});

test.each([
  ["amd64", "1.96.0"],
  ["arm64", "1.98.1"],
] as const)("FreeBSD %s builds use Rust %s", (arch, version) => {
  const result = runFreebsdScript(arch, "build");
  expect(result.status).toBe(0);
  expect(result.log).toContain(
    `node scripts/build-native.ts toolchain=${version}`,
  );
  expect(result.log).toContain(
    `node scripts/verify-native-http.ts --file=prebuilds/sync_request_curl_native.freebsd-${arch === "amd64" ? "x64" : "arm64"}.node toolchain=${version}`,
  );
});
