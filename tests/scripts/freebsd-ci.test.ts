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
  command: "prepare" | "build" | "verify",
  options: {
    rustVersion?: string;
    failRustPackage?: boolean;
    invalidToolchain?: boolean;
    missingToolchain?: boolean;
    failPkg?: boolean;
    failRustup?: boolean;
    failVerify?: boolean;
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
    [
      'printf "pkg %s\\n" "$*" >> "$LOG_FILE"',
      'if [ "$FAIL_PKG" = "yes" ] || { [ "$FAIL_RUST_PACKAGE" = "yes" ] && [ "$*" = "install -y rust" ]; }; then exit 1; fi',
    ].join("\n"),
  );
  mock(
    "node",
    [
      'case "$PATH" in "$HOME/.cargo/bin:$MOCK_BIN:"* | "$MOCK_BIN:"*) ;; *) echo "Mock directory lost PATH precedence" >&2; exit 66 ;; esac',
      'if [ "$1" = "-p" ]; then',
      '  printf "freebsd-%s\\n" "$FAKE_NODE_ARCH"',
      "else",
      "  toolchain=system",
      '  if [ -n "$RUSTUP_TOOLCHAIN" ]; then toolchain="$RUSTUP_TOOLCHAIN"; fi',
      '  printf "node %s toolchain=%s\\n" "$*" "$toolchain" >> "$LOG_FILE"',
      '  if [ "$FAIL_VERIFY" = "yes" ] && [ "$1" = "scripts/verify-native-http.ts" ]; then exit 1; fi',
      "fi",
    ].join("\n"),
  );
  mock("rustup-init", 'printf "rustup-init %s\\n" "$*" >> "$LOG_FILE"');
  mock(
    "rustup",
    'printf "rustup %s\\n" "$*" >> "$LOG_FILE"; if [ "$FAIL_RUSTUP" = "yes" ]; then exit 1; fi',
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
        FAKE_RUST_VERSION:
          options.rustVersion ?? (arch === "arm64" ? "1.97.1" : "1.96.0"),
        FAIL_RUST_PACKAGE: options.failRustPackage ? "yes" : "no",
        FAIL_PKG: options.failPkg ? "yes" : "no",
        FAIL_RUSTUP: options.failRustup ? "yes" : "no",
        FAIL_VERIFY: options.failVerify ? "yes" : "no",
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

test("FreeBSD arm64 installs Rust from the native FreeBSD package", () => {
  const result = runFreebsdScript("arm64", "prepare");
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain("pkg bootstrap -f");
  expect(result.log).toContain("pkg update -f");
  expect(result.log).toContain("pkg install -y rust");
  expect(result.log).not.toContain("rustup");
  expect(result.stderr).toContain("Rust 1.97.1 meets minimum 1.96.0");
});

test("FreeBSD arm64 reports pkg bootstrap failures with their phase", () => {
  const result = runFreebsdScript("arm64", "prepare", { failPkg: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("preparation failed during pkg bootstrap");
  expect(result.log).toContain("pkg bootstrap -f");
  expect(result.log).not.toContain("pkg install -y node24");
});

test("FreeBSD arm64 identifies Rust package installation failures", () => {
  const result = runFreebsdScript("arm64", "prepare", {
    failRustPackage: true,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Failed to install FreeBSD arm64 Rust package",
  );
  expect(result.stderr).toContain(
    "preparation failed during FreeBSD Rust package installation",
  );
});

test.each(["1.95.9", "not-a-version"])(
  "FreeBSD arm64 rejects unsupported Rust version %s",
  (rustVersion) => {
    const result = runFreebsdScript("arm64", "prepare", { rustVersion });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `FreeBSD arm64 requires Rust 1.96.0 or newer; found ${rustVersion}`,
    );
    expect(result.stderr).toContain(
      "preparation failed during Rust version verification",
    );
  },
);

test.each(["1.96.0", "1.97.1", "1.100.0"])(
  "FreeBSD arm64 accepts supported Rust version %s",
  (rustVersion) => {
    const result = runFreebsdScript("arm64", "prepare", { rustVersion });
    expect(result.status, result.stderr + result.log).toBe(0);
    expect(result.stderr).toContain(`Rust ${rustVersion} meets minimum 1.96.0`);
  },
);

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

test("FreeBSD x64 Rust installation failures identify the toolchain and architecture", () => {
  const result = runFreebsdScript("amd64", "prepare", { failRustup: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Failed to install Rust toolchain 1.96.0 on FreeBSD amd64",
  );
});

test("FreeBSD CI rejects unsupported host architectures", () => {
  const result = runFreebsdScript("other", "prepare");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unsupported FreeBSD architecture: other");
});

test.each([
  ["amd64", "1.96.0"],
  ["arm64", "system"],
] as const)("FreeBSD %s builds use Rust toolchain %s", (arch, version) => {
  const result = runFreebsdScript(arch, "build");
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain(
    `node scripts/build-native.ts toolchain=${version}`,
  );
  expect(result.log).toContain(
    `node scripts/verify-native-http.ts --file=prebuilds/sync_request_curl_native.freebsd-${arch === "amd64" ? "x64" : "arm64"}.node toolchain=${version}`,
  );
});

test("FreeBSD arm64 refuses to build with an outdated Rust package", () => {
  const result = runFreebsdScript("arm64", "build", {
    rustVersion: "1.95.9",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("requires Rust 1.96.0 or newer");
  expect(result.log).not.toContain("node scripts/build-native.ts");
});

test.each([
  ["amd64", "x64"],
  ["arm64", "arm64"],
] as const)(
  "FreeBSD %s verifies cached addons without rebuilding",
  (arch, key) => {
    const result = runFreebsdScript(arch, "verify");
    expect(result.status, result.stderr + result.log).toBe(0);
    expect(result.log).toContain(
      `node scripts/verify-native-load.ts --file=prebuilds/sync_request_curl_native.freebsd-${key}.node`,
    );
    expect(result.log).toContain(
      `node scripts/verify-native-http.ts --file=prebuilds/sync_request_curl_native.freebsd-${key}.node`,
    );
    expect(result.log).not.toContain("node scripts/build-native.ts");
    expect(result.log).not.toContain("node scripts/stage-native.ts");
  },
);

test("FreeBSD cached addon verification fails on an HTTP smoke-test error", () => {
  const result = runFreebsdScript("arm64", "verify", { failVerify: true });
  expect(result.status).not.toBe(0);
  expect(result.log).toContain("node scripts/verify-native-http.ts");
  expect(result.log).not.toContain("node scripts/build-native.ts");
});

const freebsdWorkflowJob = (
  file: "native-prebuilds.yaml" | "pipeline.yaml",
  job: "build-freebsd" | "freebsd-native",
  nextJob: "collect" | "native",
): string => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, "../../.github/workflows", file),
    "utf8",
  );
  const start = workflow.indexOf(`\n  ${job}:\n`);
  const end = workflow.indexOf(`\n  ${nextJob}:\n`, start);
  if (start === -1 || end === -1) {
    throw new Error(`Unable to find ${job} in ${file}`);
  }
  return workflow.slice(start, end);
};

test("FreeBSD release and pipeline jobs share the exact cache key", () => {
  const release = freebsdWorkflowJob(
    "native-prebuilds.yaml",
    "build-freebsd",
    "collect",
  );
  const pipeline = freebsdWorkflowJob(
    "pipeline.yaml",
    "freebsd-native",
    "native",
  );
  const key = /\bkey: (freebsd-prebuild-[^\n]+)/;
  const releaseKey = release.match(key)?.[1];
  const pipelineKey = pipeline.match(key)?.[1];
  expect(releaseKey).toBeDefined();
  expect(releaseKey).toBe(pipelineKey);
  expect(releaseKey).toContain("'native/build.ts'");
  expect(releaseKey).toContain("'scripts/freebsd-ci.sh'");
});

test("main pipeline smoke-tests FreeBSD artifacts before caching them", () => {
  const pipeline = freebsdWorkflowJob(
    "pipeline.yaml",
    "freebsd-native",
    "native",
  );
  expect(pipeline).toContain("uses: actions/cache@v4");
  expect(pipeline).toContain("uses: vmactions/freebsd-vm@");
  expect(pipeline).toContain("run: sh scripts/freebsd-ci.sh");
  expect(pipeline).toContain("&& 'verify' || 'build'");
  expect(pipeline).toContain("run: test -s prebuilds/");
});

test("release skips the FreeBSD VM only for an exact cache hit", () => {
  const release = freebsdWorkflowJob(
    "native-prebuilds.yaml",
    "build-freebsd",
    "collect",
  );
  expect(release).toMatch(
    /if: steps\.native-cache\.outputs\.cache-hit == 'true'\n\s+run: echo /,
  );
  expect(release).toMatch(
    /if: steps\.native-cache\.outputs\.cache-hit != 'true'\n\s+uses: vmactions\/freebsd-vm@/,
  );
  expect(release).toContain("run: sh scripts/freebsd-ci.sh build");
  expect(release).toContain("run: test -s prebuilds/");
  expect(release).toContain("if-no-files-found: error");
});

test("the FreeBSD cache is warmed on main without triggering npm publication", () => {
  const pipeline = readFileSync(
    resolve(import.meta.dirname, "../../.github/workflows/pipeline.yaml"),
    "utf8",
  );
  const release = readFileSync(
    resolve(
      import.meta.dirname,
      "../../.github/workflows/native-prebuilds.yaml",
    ),
    "utf8",
  );
  const publish = readFileSync(
    resolve(import.meta.dirname, "../../.github/workflows/publish.yaml"),
    "utf8",
  );
  expect(pipeline).toMatch(/on:\n {2}push:\n {4}branches:\n {6}- main\n/);
  expect(release).toMatch(
    /on:\n {2}workflow_dispatch:\n {2}push:\n {4}tags:\n {6}- 'v\*'/,
  );
  expect(publish).toContain("github.event.workflow_run.event == 'push'");
});
