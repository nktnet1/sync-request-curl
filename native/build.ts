import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nativeDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(nativeDir);
const targetDir = join(nativeDir, "target");
const buildDir = join(nativeDir, "build");
const output = join(buildDir, "sync_request_curl_native.node");

type CurlSource = "bundled" | "system";

type CliOptions = {
  curlSource?: CurlSource;
  help: boolean;
};

const usage = `Usage: sync-request-curl-build [--libcurl=system|bundled]

Build the installed sync-request-curl addon from its bundled Rust sources.
Requires the Rust toolchain pinned by rust-toolchain.toml and platform native build tools.
Run using the same Node.js architecture as your application.
Set CARGO_BUILD_TARGET to override the Rust target.

Options:
  --libcurl=system    Link against a system-provided libcurl and fail if unavailable.
  --libcurl=bundled   Build the libcurl bundled by curl-sys.

Default: bundled libcurl on all targets. HTTP/3 is enabled where the bundled AWS-LC backend is supported; Windows x86 uses the HTTP/2 bundled build. Use --libcurl=system to opt into a system-provided libcurl.`;

const parseCliOptions = (args: readonly string[]): CliOptions => {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { help: true };
  }

  let curlSource: CurlSource | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    let value: string | undefined;

    if (argument === "--libcurl") {
      value = args[index + 1];
      index += 1;
    } else if (argument?.startsWith("--libcurl=")) {
      value = argument.slice("--libcurl=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}. Use --help for usage.`);
    }

    if (value !== "system" && value !== "bundled") {
      throw new Error(
        `Invalid --libcurl value: ${value ?? "(missing)"}. Expected system or bundled.`,
      );
    }
    if (curlSource !== undefined) {
      throw new Error("--libcurl may only be specified once.");
    }
    curlSource = value;
  }

  return { curlSource, help: false };
};

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
        "Source builds require the Rust toolchain pinned by rust-toolchain.toml, a platform C/C++ toolchain, CMake 3.20+, make, Perl, and pkg-config on Unix. " +
        "Install the Rust target and native toolchain matching your Node.js architecture.",
    );
  }
  return result.stdout?.trim() || "";
};

const buildNative = (requestedCurlSource?: CurlSource): void => {
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
  const curlSource = requestedCurlSource ?? "bundled";
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
  const bundledFeature = [
    "i686-pc-windows-msvc",
    "x86_64-pc-windows-gnu",
  ].includes(target)
    ? "bundled-curl"
    : "bundled-curl-http3";
  run(
    "cargo",
    [
      "build",
      "--locked",
      "--manifest-path",
      join(nativeDir, "Cargo.toml"),
      "--release",
      "--no-default-features",
      "--features",
      curlSource === "system" ? "system-curl" : bundledFeature,
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
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  buildNative(options.curlSource);
};

main();
