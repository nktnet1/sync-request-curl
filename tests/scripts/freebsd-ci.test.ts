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
  options: {
    badDigest?: boolean;
    invalidToolchain?: boolean;
    missingToolchain?: boolean;
    failPkg?: boolean;
    failRustup?: boolean;
    pinnedToolchain?: string;
  } = {},
) => {
  const root = mkdtempSync(join(tmpdir(), "freebsd-ci-test-"));
  directories.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "commands.log");
  writeFileSync(log, "");
  if (!options.missingToolchain) {
    const toolchain = options.invalidToolchain
      ? '[toolchain]\nprofile = "minimal"\n'
      : options.pinnedToolchain
        ? `[toolchain]\nchannel = "${options.pinnedToolchain}"\n`
        : readFileSync(
            resolve(import.meta.dirname, "../../rust-toolchain.toml"),
            "utf8",
          );
    writeFileSync(join(root, "rust-toolchain.toml"), toolchain);
  }

  const mock = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

  mock("uname", 'printf "%s\\n" "$FAKE_ARCH"');
  mock(
    "pkg",
    'printf "pkg %s\\n" "$*" >> "$LOG_FILE"; if [ "$FAIL_PKG" = "yes" ]; then exit 1; fi',
  );
  mock(
    "node",
    [
      'case "$PATH" in "$HOME/.cargo/bin:$MOCK_BIN:"*) ;; *) echo "Mock directory lost PATH precedence" >&2; exit 66 ;; esac',
      'if [ "$1" = "-p" ]; then',
      '  printf "freebsd-%s\\n" "$FAKE_NODE_ARCH"',
      "else",
      '  printf "node %s toolchain=%s\\n" "$*" "$RUSTUP_TOOLCHAIN" >> "$LOG_FILE"',
      "fi",
    ].join("\n"),
  );
  mock("rustup-init", 'printf "rustup-init %s\\n" "$*" >> "$LOG_FILE"');
  mock(
    "rustup",
    'printf "rustup %s\\n" "$*" >> "$LOG_FILE"; if [ "$FAIL_RUSTUP" = "yes" ]; then exit 1; fi',
  );
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
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        LOG_FILE: log,
        MOCK_BIN: bin,
        FAKE_ARCH: arch,
        FAKE_NODE_ARCH: arch === "amd64" ? "x64" : "arm64",
        FAKE_RUST_VERSION: arch === "arm64" ? "1.98.1" : "1.96.0",
        BAD_DIGEST: options.badDigest ? "yes" : "no",
        FAIL_PKG: options.failPkg ? "yes" : "no",
        FAIL_RUSTUP: options.failRustup ? "yes" : "no",
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
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain("pkg install -y rustup-init");
  expect(result.log).toContain("rustup-init -y --no-modify-path");
  expect(result.log).toContain("rustup toolchain install 1.96.0");
  expect(result.log).not.toContain("downloaded-rustup");
  expect(result.log).not.toContain("node scripts/rust-toolchain.ts");
});

test("FreeBSD x64 reads changes to the pinned Rust version", () => {
  const result = runFreebsdScript("amd64", "prepare", {
    pinnedToolchain: "1.97.7",
  });
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain("rustup toolchain install 1.97.7");
});

test("FreeBSD arm64 uses the verified official installer and newer toolchain", () => {
  const result = runFreebsdScript("arm64", "prepare");
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain("pkg bootstrap -f");
  expect(result.log).toContain("pkg update -f");
  expect(result.log).not.toContain("pkg install -y rustup-init");
  expect(result.log).toContain("downloaded-rustup -y --no-modify-path");
  expect(result.log).toContain("rustup toolchain install 1.98.1");
});

test("FreeBSD arm64 reports pkg bootstrap failures with their phase", () => {
  const result = runFreebsdScript("arm64", "prepare", { failPkg: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("preparation failed during pkg bootstrap");
  expect(result.log).toContain("pkg bootstrap -f");
  expect(result.log).not.toContain("pkg install -y node24");
});

test("FreeBSD arm64 refuses an installer with a bad checksum", () => {
  const result = runFreebsdScript("arm64", "prepare", { badDigest: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("SHA-256 verification failed");
  expect(result.stderr).toContain(
    "preparation failed during rustup checksum verification",
  );
  expect(result.log).not.toContain("downloaded-rustup");
});

test.each(["invalidToolchain", "missingToolchain"] as const)(
  "FreeBSD x64 rejects an %s configuration",
  (setting) => {
    const result = runFreebsdScript("amd64", "prepare", { [setting]: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      setting === "invalidToolchain"
        ? "Missing Rust channel in rust-toolchain.toml"
        : "Missing rust-toolchain.toml",
    );
    expect(result.log).not.toContain("rustup toolchain install");
  },
);

test("FreeBSD package failures are identified before Rust installation", () => {
  const result = runFreebsdScript("amd64", "prepare", { failPkg: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "FreeBSD dependency installation failed (pkg)",
  );
  expect(result.log).not.toContain("rustup toolchain install");
});

test("FreeBSD Rust installation failures identify the toolchain and architecture", () => {
  const result = runFreebsdScript("arm64", "prepare", { failRustup: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Failed to install Rust toolchain 1.98.1 on FreeBSD arm64",
  );
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
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain(
    `node scripts/build-native.ts toolchain=${version}`,
  );
  expect(result.log).toContain(
    `node scripts/verify-native-http.ts --file=prebuilds/sync_request_curl_native.freebsd-${arch === "amd64" ? "x64" : "arm64"}.node toolchain=${version}`,
  );
});
