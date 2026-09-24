/* eslint-disable security/detect-non-literal-fs-filename -- Build tooling only accesses trusted repository, CI, or explicit CLI paths. */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getCurrentPlatformKey,
  getPrebuildFilename,
} from "#scripts/native-platform";
import { canRun, run, splitFlags } from "#scripts/process";

const root = resolve(import.meta.dirname, "..");
const nativeDir = join(root, "native");
const buildDir = join(nativeDir, "build");
const localOutputs = [
  join(buildDir, "sync_request_curl_native.node"),
  join(buildDir, "Release", "sync_request_curl_native.node"),
];
const args = new Set(process.argv.slice(2));
const useCmake = args.has("--cmake");
const ifNeeded = args.has("--if-needed");

mkdirSync(buildDir, { recursive: true });

const listNativeSources = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "build") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listNativeSources(path));
    else files.push(path);
  }
  return files;
};

const existingLocalOutput = (): string | undefined =>
  localOutputs.find((candidate) => existsSync(candidate));

const localBuildIsStale = (output: string): boolean => {
  const outputTime = statSync(output).mtimeMs;
  return listNativeSources(nativeDir).some(
    (source) => statSync(source).mtimeMs > outputTime,
  );
};

const matchingPrebuild = (): string =>
  join(root, "prebuilds", getPrebuildFilename(getCurrentPlatformKey()));

const shouldSkipIfNeededBuild = (): boolean => {
  if (!ifNeeded) return false;

  const localOutput = existingLocalOutput();
  if (localOutput) {
    if (localBuildIsStale(localOutput)) return false;
    console.log(`Native addon is up to date: ${localOutput}`);
    return true;
  }

  const prebuild = matchingPrebuild();
  if (existsSync(prebuild)) {
    console.log(`Using matching native prebuild: ${prebuild}`);
    return true;
  }

  return false;
};

const buildWithCmake = (): void => {
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
  const definitions: Array<[string, string | undefined]> = [
    ["CMAKE_TOOLCHAIN_FILE", process.env.CMAKE_TOOLCHAIN_FILE],
    ["VCPKG_TARGET_TRIPLET", process.env.VCPKG_TARGET_TRIPLET],
    ["CMAKE_PREFIX_PATH", process.env.CMAKE_PREFIX_PATH],
    [
      "NODE_IMPORT_LIB",
      process.env.NODE_IMPORT_LIB ??
        (existsSync(nodeImportLib) ? nodeImportLib : undefined),
    ],
  ];

  for (const [name, value] of definitions) {
    if (value) configureArgs.push(`-D${name}=${value}`);
  }

  run("cmake", configureArgs, { cwd: root });
  run("cmake", ["--build", buildDir, "--config", "Release", "--parallel"], {
    cwd: root,
  });
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
  localOutputs[0],
];

const buildMacos = (): void => {
  if (!canRun("xcrun", ["--find", "clang++"])) {
    throw new Error(
      "Local native builds on macOS require the Xcode Command Line Tools. " +
        "Install them with: xcode-select --install",
    );
  }

  const compiler = run("xcrun", ["--find", "clang++"], {
    capture: true,
    cwd: root,
  });
  const sdkPath = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
    capture: true,
    cwd: root,
  });

  run(
    compiler,
    [
      ...commonCompilerArgs,
      "-isysroot",
      sdkPath,
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-lcurl",
    ],
    { cwd: root },
  );
};

const getPkgConfigCurlFlags = (): string[] | undefined => {
  if (!canRun("pkg-config", ["--exists", "libcurl"])) return undefined;
  return [
    ...splitFlags(
      run("pkg-config", ["--cflags", "libcurl"], { capture: true }),
    ),
    ...splitFlags(run("pkg-config", ["--libs", "libcurl"], { capture: true })),
  ];
};

const getCurlConfigFlags = (): string[] | undefined => {
  if (!canRun("curl-config", ["--version"])) return undefined;
  return [
    ...splitFlags(run("curl-config", ["--cflags"], { capture: true })),
    ...splitFlags(run("curl-config", ["--libs"], { capture: true })),
  ];
};

const getLinuxCurlFlags = (): string[] => {
  const flags = getPkgConfigCurlFlags() ?? getCurlConfigFlags();
  if (flags) return flags;

  throw new Error(
    "Local native builds on Linux require libcurl development files and either " +
      "pkg-config or curl-config (for example: apt install g++ libcurl4-openssl-dev pkg-config).",
  );
};

const buildLinux = (): void => {
  const candidates = process.env.CXX
    ? [process.env.CXX]
    : ["c++", "g++", "clang++"];
  const compiler = candidates.find((candidate) => canRun(candidate));
  if (!compiler) {
    throw new Error(
      "Local native builds on Linux require a C++17 compiler (CXX, c++, g++, or clang++).",
    );
  }

  run(
    compiler,
    [...commonCompilerArgs, "-fPIC", "-shared", ...getLinuxCurlFlags()],
    { cwd: root },
  );
};

const buildLocal = () => {
  if (process.platform === "darwin") {
    return buildMacos();
  }
  if (process.platform === "linux") {
    return buildLinux();
  }
  if (process.platform === "win32") {
    throw new Error(
      "Local Windows native builds currently use the CMake path. " +
        "Install CMake and run pnpm build:native:cmake.",
    );
  }
  throw new Error(`Unsupported local build platform: ${process.platform}`);
};

if (!shouldSkipIfNeededBuild()) {
  if (useCmake) buildWithCmake();
  else buildLocal();

  const output = existingLocalOutput();
  if (!output)
    throw new Error("Native build completed without producing the addon");
  console.log(`Built native addon: ${output}`);
}
