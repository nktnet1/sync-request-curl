#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nativeDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(nativeDir);
const targetDir = join(nativeDir, "target");
const buildDir = join(nativeDir, "build");
const output = join(buildDir, "sync_request_curl_native.node");

const run = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  capture = false,
): string => {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.signal || result.status}. ` +
        "Source builds require Rust 1.88+, a platform C/C++ toolchain, make, Perl, and pkg-config on Unix. " +
        "Install the Rust target and native toolchain matching your Node.js architecture.",
    );
  }
  return result.stdout?.trim() || "";
};

const buildNative = (): void => {
  const host = run("rustc", ["-vV"], process.env, true)
    .split("\n")
    .find((line) => line.startsWith("host: "))
    ?.slice(6)
    .trim();
  const windowsTargets: Readonly<Record<string, string>> = {
    ia32: "i686-pc-windows-msvc",
    x64: "x86_64-pc-windows-msvc",
    arm64: "aarch64-pc-windows-msvc",
  };
  const target =
    process.env.CARGO_BUILD_TARGET ||
    (process.platform === "win32" ? windowsTargets[process.arch] : host);
  if (!target) {
    throw new Error(
      "Unable to determine Rust target; set CARGO_BUILD_TARGET explicitly.",
    );
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_TARGET_DIR: targetDir,
    LIBZ_SYS_STATIC: "1",
    OPENSSL_STATIC: "1",
    PKG_CONFIG_ALL_STATIC: "1",
  };
  // Rust's musl defaults otherwise prevent producing a loadable shared library.
  if (target.includes("musl")) {
    if (env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
      env.CARGO_ENCODED_RUSTFLAGS += `${env.CARGO_ENCODED_RUSTFLAGS ? "\x1f" : ""}-C\x1ftarget-feature=-crt-static`;
    } else {
      env.RUSTFLAGS =
        `${env.RUSTFLAGS || ""} -C target-feature=-crt-static`.trim();
    }
  }
  run(
    "cargo",
    [
      "build",
      "--locked",
      "--manifest-path",
      join(nativeDir, "Cargo.toml"),
      "--release",
      "--target",
      target,
    ],
    env,
  );
  let library = "libsync_request_curl_native.so";
  if (process.platform === "win32") {
    library = "sync_request_curl_native.dll";
  } else if (process.platform === "darwin") {
    library = "libsync_request_curl_native.dylib";
  }
  mkdirSync(buildDir, { recursive: true });
  const temporary = join(
    buildDir,
    `sync_request_curl_native.${process.pid}.node`,
  );
  try {
    copyFileSync(join(targetDir, target, "release", library), temporary);
    // Validate in a child process before replacing a working addon. This also catches
    // wrong-architecture targets and missing shared dependencies without loading it here.
    run(process.execPath, [
      "-e",
      `
      const binding = require(process.argv[1]);
      for (const name of ['request', 'createConnectionPool', 'releaseConnectionPool']) {
        if (typeof binding[name] !== 'function') throw new Error('Missing native export: ' + name);
      }
    `,
      temporary,
    ]);
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
  console.log(`Built native addon: ${output}`);
};

const main = (): void => {
  const cliArgs = process.argv.slice(2);
  if (
    cliArgs.length === 1 &&
    (cliArgs[0] === "--help" || cliArgs[0] === "-h")
  ) {
    console.log(
      "Usage: sync-request-curl-build\n\n" +
        "Build the installed sync-request-curl addon from its bundled Rust sources.\n" +
        "Requires Rust 1.88+ and platform native build tools.\n" +
        "Run using the same Node.js architecture as your application.\n" +
        "Set CARGO_BUILD_TARGET to override the Rust target.",
    );
    return;
  }
  if (cliArgs.length > 0) {
    throw new Error("Unknown arguments. Use sync-request-curl-build --help.");
  }

  buildNative();
};

main();
