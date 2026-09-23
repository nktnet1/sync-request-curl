import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const nativeDir = join(root, "native");
const buildDir = join(nativeDir, "build");
const output = join(buildDir, "sync_request_curl_native.node");
const args = new Set(process.argv.slice(2));
const useCmake = args.has("--cmake");
const ifNeeded = args.has("--if-needed");

mkdirSync(buildDir, { recursive: true });

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    env: process.env,
  });

  if (result.error) {
    const error = new Error(`Unable to run ${command}: ${result.error.message}`);
    error.cause = result.error;
    throw error;
  }
  if (result.status !== 0) {
    if (options.capture) {
      const stderr = result.stderr?.trim();
      throw new Error(
        `${command} ${commandArgs.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
      );
    }
    process.exit(result.status ?? 1);
  }

  return options.capture ? result.stdout.trim() : "";
};

const canRun = (command, commandArgs = ["--version"]) => {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "ignore",
    env: process.env,
  });
  return !result.error && result.status === 0;
};

const splitFlags = (value) => {
  const flags = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of value.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        flags.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  if (quote) throw new Error("Unterminated quote in compiler flags");
  if (current) flags.push(current);
  return flags;
};

const listSourceFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "build") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (/\.(?:cc|cpp|c|h|hpp)$/.test(entry.name)) files.push(path);
  }
  return files;
};

const needsBuild = () => {
  if (!existsSync(output)) return true;
  const outputTime = statSync(output).mtimeMs;
  return listSourceFiles(nativeDir).some(
    (source) => statSync(source).mtimeMs > outputTime,
  );
};

const buildWithCmake = () => {
  if (!canRun("cmake")) {
    throw new Error(
      "CMake is required for the release/native-prebuild build path. " +
        "For local macOS/Linux development, run pnpm build:native without --cmake.",
    );
  }

  const nodeImportLib = join(buildDir, "node.lib");
  const configureArgs = [
    "-S",
    nativeDir,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
  ];

  for (const [name, value] of [
    ["CMAKE_TOOLCHAIN_FILE", process.env.CMAKE_TOOLCHAIN_FILE],
    ["VCPKG_TARGET_TRIPLET", process.env.VCPKG_TARGET_TRIPLET],
    ["CMAKE_PREFIX_PATH", process.env.CMAKE_PREFIX_PATH],
    [
      "NODE_IMPORT_LIB",
      process.env.NODE_IMPORT_LIB ??
        (existsSync(nodeImportLib) ? nodeImportLib : undefined),
    ],
  ]) {
    if (value) configureArgs.push(`-D${name}=${value}`);
  }

  run("cmake", configureArgs);
  run("cmake", ["--build", buildDir, "--config", "Release", "--parallel"]);
};

const commonCompilerArgs = [
  "-std=c++17",
  "-O3",
  "-DNDEBUG",
  "-DNAPI_VERSION=8",
  "-DBUILDING_NODE_EXTENSION",
  `-I${join(nativeDir, "node-api")}`,
  join(nativeDir, "addon.cc"),
  "-o",
  output,
];

const buildMacos = () => {
  if (!canRun("xcrun", ["--find", "clang++"])) {
    throw new Error(
      "Local native builds on macOS require the Xcode Command Line Tools. " +
        "Install them with: xcode-select --install",
    );
  }

  const compiler = run("xcrun", ["--find", "clang++"], { capture: true });
  const sdkPath = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
    capture: true,
  });

  run(compiler, [
    ...commonCompilerArgs,
    "-isysroot",
    sdkPath,
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-lcurl",
  ]);
};

const getLinuxCurlFlags = () => {
  if (canRun("pkg-config", ["--exists", "libcurl"])) {
    return [
      ...splitFlags(run("pkg-config", ["--cflags", "libcurl"], { capture: true })),
      ...splitFlags(run("pkg-config", ["--libs", "libcurl"], { capture: true })),
    ];
  }

  if (canRun("curl-config", ["--version"])) {
    return [
      ...splitFlags(run("curl-config", ["--cflags"], { capture: true })),
      ...splitFlags(run("curl-config", ["--libs"], { capture: true })),
    ];
  }

  throw new Error(
    "Local native builds on Linux require libcurl development files and either " +
      "pkg-config or curl-config (for example: apt install g++ libcurl4-openssl-dev pkg-config).",
  );
};

const buildLinux = () => {
  const candidates = process.env.CXX
    ? [process.env.CXX]
    : ["c++", "g++", "clang++"];
  const compiler = candidates.find((candidate) => canRun(candidate));
  if (!compiler) {
    throw new Error(
      "Local native builds on Linux require a C++17 compiler (CXX, c++, g++, or clang++).",
    );
  }

  run(compiler, [
    ...commonCompilerArgs,
    "-fPIC",
    "-shared",
    ...getLinuxCurlFlags(),
  ]);
};

const buildLocal = () => {
  if (process.platform === "darwin") {
    buildMacos();
    return;
  }
  if (process.platform === "linux") {
    buildLinux();
    return;
  }
  if (process.platform === "win32") {
    throw new Error(
      "Local Windows native builds currently use the CMake path. " +
        "Install CMake and run pnpm build:native:cmake.",
    );
  }
  throw new Error(`Unsupported local build platform: ${process.platform}`);
};

if (ifNeeded && !needsBuild()) {
  console.log(`Native addon is up to date: ${output}`);
  process.exit(0);
}

if (useCmake) buildWithCmake();
else buildLocal();

console.log(`Built native addon: ${output}`);
