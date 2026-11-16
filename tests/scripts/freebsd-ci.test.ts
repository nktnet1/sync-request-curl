import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { runFreebsdCi } from "#scripts/build/freebsd/ci";
import { useTemporaryDirectories } from "./helpers/temp-directories";

const script = resolve(
  import.meta.dirname,
  "../../scripts/build/freebsd/prepare.sh",
);
const makeTemporaryDirectory = useTemporaryDirectories();

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
    invalidLibrary?: boolean;
    mismatchNodeArch?: boolean;
    useCli?: boolean;
    pinnedToolchain?: string;
  } = {},
) => {
  const root = makeTemporaryDirectory("freebsd-ci-test-");
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
      '  if [ "$FAIL_VERIFY" = "yes" ] && [ "$1" = "scripts/build/verify-native-http.ts" ]; then exit 1; fi',
      "fi",
    ].join("\n"),
  );
  mock("rustup-init", 'printf "rustup-init %s\\n" "$*" >> "$LOG_FILE"');
  mock(
    "rustup",
    'printf "rustup %s\\n" "$*" >> "$LOG_FILE"; if [ "$FAIL_RUSTUP" = "yes" ]; then exit 1; fi',
  );
  mock("rustc", 'printf "rustc %s (mock)\\n" "$FAKE_RUST_VERSION"');
  mock(
    "ldd",
    'if [ "$INVALID_LIBRARY" = "yes" ]; then printf "libcrypto.so => /usr/local/lib/libcrypto.so\\n"; else printf "libc.so.7 => /lib/libc.so.7\\n"; fi',
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: root,
    LOG_FILE: log,
    MOCK_BIN: bin,
    FAKE_ARCH: arch,
    FAKE_NODE_ARCH: options.mismatchNodeArch
      ? "unknown"
      : arch === "amd64"
        ? "x64"
        : "arm64",
    FAKE_RUST_VERSION:
      options.rustVersion ?? (arch === "arm64" ? "1.97.1" : "1.96.0"),
    FAIL_RUST_PACKAGE: options.failRustPackage ? "yes" : "no",
    FAIL_PKG: options.failPkg ? "yes" : "no",
    FAIL_RUSTUP: options.failRustup ? "yes" : "no",
    FAIL_VERIFY: options.failVerify ? "yes" : "no",
    INVALID_LIBRARY: options.invalidLibrary ? "yes" : "no",
  };
  if (command === "prepare") {
    const result = spawnSync("sh", [script], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    return { ...result, log: readFileSync(log, "utf8") };
  }

  if (options.useCli) {
    const scriptFolder = join(root, "scripts/build/freebsd");
    mkdirSync(scriptFolder, { recursive: true });
    mkdirSync(join(root, "scripts/build"), { recursive: true });
    mkdirSync(join(root, "scripts/shared"), { recursive: true });
    for (const file of [
      "scripts/build/freebsd/ci.ts",
      "scripts/build/rust-toolchain.ts",
      "scripts/shared/process.ts",
    ]) {
      copyFileSync(
        resolve(import.meta.dirname, "../..", file),
        join(root, file),
      );
    }
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        type: "module",
        imports: { "#scripts/*": "./scripts/*.ts" },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        join(scriptFolder, "ci.ts"),
        command,
        `freebsd-${arch === "amd64" ? "x64" : "arm64"}`,
      ],
      { cwd: root, env, encoding: "utf8" },
    );
    return { ...result, log: readFileSync(log, "utf8") };
  }

  try {
    runFreebsdCi(command, `freebsd-${arch === "amd64" ? "x64" : "arm64"}`, {
      root,
      env,
    });
    return { status: 0, stderr: "", log: readFileSync(log, "utf8") };
  } catch (error) {
    return { status: 1, stderr: String(error), log: readFileSync(log, "utf8") };
  }
};

test("FreeBSD x64 uses the packaged installer and pinned toolchain", () => {
  const result = runFreebsdScript("amd64", "prepare");
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain("pkg install -y rustup-init");
  expect(result.log).toContain("rustup-init -y --no-modify-path");
  expect(result.log).toContain("rustup toolchain install 1.96.0");
  expect(result.log).not.toContain("downloaded-rustup");
  expect(result.log).not.toContain("node scripts/build/rust-toolchain.ts");
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
    `node scripts/build/build-native.ts toolchain=${version}`,
  );
  expect(result.log).toContain(
    `node scripts/build/verify-native-http.ts --file=prebuilds/sync_request_curl_native.freebsd-${arch === "amd64" ? "x64" : "arm64"}.node toolchain=${version}`,
  );
});

test("FreeBSD arm64 refuses to build with an outdated Rust package", () => {
  const result = runFreebsdScript("arm64", "build", {
    rustVersion: "1.95.9",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("requires Rust 1.96.0 or newer");
  expect(result.log).not.toContain("node scripts/build/build-native.ts");
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
      `node scripts/build/verify-native-load.ts --file=prebuilds/sync_request_curl_native.freebsd-${key}.node`,
    );
    expect(result.log).toContain(
      `node scripts/build/verify-native-http.ts --file=prebuilds/sync_request_curl_native.freebsd-${key}.node`,
    );
    expect(result.log).not.toContain("node scripts/build/build-native.ts");
    expect(result.log).not.toContain("node scripts/build/stage-native.ts");
  },
);

test("FreeBSD cached addon verification fails on an HTTP smoke-test error", () => {
  const result = runFreebsdScript("arm64", "verify", { failVerify: true });
  expect(result.status).not.toBe(0);
  expect(result.log).toContain("node scripts/build/verify-native-http.ts");
  expect(result.log).not.toContain("node scripts/build/build-native.ts");
});

test("FreeBSD native verification CLI runs as an independent TypeScript script", () => {
  const result = runFreebsdScript("arm64", "verify", { useCli: true });
  expect(result.status, result.stderr + result.log).toBe(0);
  expect(result.log).toContain("node scripts/build/verify-native-http.ts");
});

test("FreeBSD native build checks Node architecture before attempting compilation", () => {
  const result = runFreebsdScript("arm64", "build", {
    mismatchNodeArch: true,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Expected Node platform freebsd-arm64");
  expect(result.log).not.toContain("node scripts/build/build-native.ts");
});

test("FreeBSD verification rejects host-linked native dependencies", () => {
  const result = runFreebsdScript("amd64", "verify", {
    invalidLibrary: true,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "unexpected runtime dependencies under /usr/local",
  );
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

test("main FreeBSD cache keys cover native inputs without sharing binaries with releases", () => {
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
  const pipelineKey = pipeline.match(key)?.[1];
  expect(pipelineKey).toBeDefined();
  expect(pipelineKey).toContain("'native/build.ts'");
  expect(pipelineKey).toContain("'native/src/**'");
  expect(pipelineKey).toContain("'scripts/build/freebsd/**'");
  expect(release).not.toMatch(key);
  expect(release).not.toContain("uses: actions/cache@");
});

test("main pipeline smoke-tests FreeBSD artifacts before caching them", () => {
  const pipeline = freebsdWorkflowJob(
    "pipeline.yaml",
    "freebsd-native",
    "native",
  );
  expect(pipeline).toContain("uses: actions/cache@v4");
  expect(pipeline).toContain("uses: vmactions/freebsd-vm@");
  expect(pipeline).toContain("run: node scripts/build/freebsd/cross.ts");
  expect(pipeline).toContain("steps.native-cache.outputs.cache-hit != 'true'");
  expect(pipeline).toContain("continue-on-error: true");
  expect(pipeline).toContain("steps.cross-node.outcome == 'success'");
  expect(pipeline).toContain("steps.cross-setup.outcome == 'success'");
  expect(pipeline).toContain("steps.cross-node.outcome == 'failure'");
  expect(pipeline).toContain("steps.cross-setup.outcome == 'failure'");
  expect(pipeline).toContain("steps.cross.outcome == 'success'");
  expect(pipeline).toContain("run: node scripts/build/freebsd/ci.ts");
  expect(pipeline).toContain("&& 'verify' || 'build'");
  expect(pipeline).toContain(
    "run: node scripts/build/freebsd/ci.ts build freebsd-arm64",
  );
  expect(pipeline).toContain("run: test -s prebuilds/");
});

test("releases rebuild and smoke-test FreeBSD addons rather than trusting CI caches", () => {
  const release = freebsdWorkflowJob(
    "native-prebuilds.yaml",
    "build-freebsd",
    "collect",
  );
  expect(release).toContain("persist-credentials: false");
  expect(release).not.toContain("native-cache");
  expect(release).not.toContain("cache-hit");
  expect(release).toContain("uses: vmactions/freebsd-vm@");
  expect(release).toContain("sh scripts/build/freebsd/prepare.sh");
  expect(release).toContain("run: node scripts/build/freebsd/cross.ts");
  expect(release).toContain("steps.cross-setup.outcome == 'success'");
  expect(release).toContain("steps.cross-setup.outcome == 'failure'");
  expect(release).toContain(
    "steps.cross.outcome == 'success' && 'verify' || 'build'",
  );
  expect(release).toContain(
    "run: node scripts/build/freebsd/ci.ts build freebsd-arm64",
  );
  expect(release).toContain("run: test -s prebuilds/");
  expect(release).toContain("uses: actions/upload-artifact@v4");
  expect(release).toContain("if-no-files-found: error");
});

test("main warms the FreeBSD cache but only the dedicated tag workflow publishes", () => {
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
  const publishJob = publish.split("\n  publish:\n")[1];

  expect(pipeline).toMatch(/on:\n {2}push:\n {4}branches:\n {6}- main\n/);
  expect(pipeline).toContain("key: freebsd-prebuild-");
  expect(pipeline).not.toContain("id-token: write");
  expect(release).toMatch(/on:\n {2}workflow_call:\n {2}workflow_dispatch:/);
  expect(release).not.toContain("workflow_run:");
  expect(release).not.toContain("id-token: write");
  expect(release).not.toContain("\n  publish:\n");
  expect(publish).toMatch(/on:\n {2}push:\n {4}tags:\n {6}- ["']v\*["']/);
  expect(publish).not.toContain("workflow_run:");
  expect(publish).toContain("uses: ./.github/workflows/native-prebuilds.yaml");
  expect(publishJob).toBeDefined();
  expect(publishJob).toContain(
    "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
  );
  expect(publishJob).toContain("needs: build-release");
  expect(publishJob).toContain("environment: Production");
  expect(publishJob).toContain("id-token: write");
  expect(publishJob).toContain('--expected-sha="$BUILD_SHA"');
});
