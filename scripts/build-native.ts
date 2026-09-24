import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  getCurrentPlatformKey,
  getPrebuildFilename,
} from "#scripts/native-platform";
import { canRun, run } from "#scripts/process";

const root = resolve(import.meta.dirname, "..");
const nativeDir = join(root, "native");
const buildDir = join(nativeDir, "build");
const targetDir = join(nativeDir, "target");
const localOutput = join(buildDir, "sync_request_curl_native.node");
const ifNeeded = new Set(process.argv.slice(2)).has("--if-needed");

mkdirSync(buildDir, { recursive: true });

const listNativeSources = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "build" || entry.name === "target") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listNativeSources(path));
    else files.push(path);
  }
  return files;
};

const localBuildIsStale = (): boolean => {
  const outputTime = statSync(localOutput).mtimeMs;
  const sources = [
    ...listNativeSources(nativeDir),
    join(root, "rust-toolchain.toml"),
  ];
  return sources.some((source) => statSync(source).mtimeMs > outputTime);
};

const matchingPrebuild = (): string =>
  join(root, "prebuilds", getPrebuildFilename(getCurrentPlatformKey()));

const shouldSkipIfNeededBuild = (): boolean => {
  if (!ifNeeded) return false;

  if (existsSync(localOutput)) {
    if (localBuildIsStale()) return false;
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

const cargoLibrary = (): string => {
  if (process.platform === "win32") return "sync_request_curl_native.dll";
  if (process.platform === "darwin") return "libsync_request_curl_native.dylib";
  if (process.platform === "linux") return "libsync_request_curl_native.so";
  throw new Error(`Unsupported native build platform: ${process.platform}`);
};

const buildNative = (): void => {
  if (!canRun("cargo")) {
    throw new Error(
      "Rust 1.88 or newer is required to build the native addon. " +
        "Package consumers use prebuilt addons and do not need Rust installed.",
    );
  }

  const platform = getCurrentPlatformKey();
  const rustFlags = [
    process.env.RUSTFLAGS,
    platform.endsWith("-musl") ? "-C target-feature=-crt-static" : undefined,
    process.platform === "linux" ? "-C link-arg=-static-libgcc" : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_TARGET_DIR: targetDir,
    LIBZ_SYS_STATIC: "1",
    OPENSSL_STATIC: "1",
    PKG_CONFIG_ALL_STATIC: "1",
  };
  if (rustFlags) env.RUSTFLAGS = rustFlags;

  run(
    "cargo",
    ["build", "--manifest-path", join(nativeDir, "Cargo.toml"), "--release"],
    { cwd: root, env },
  );

  const cargoOutput = join(targetDir, "release", cargoLibrary());
  if (!existsSync(cargoOutput)) {
    throw new Error(
      `Cargo completed without producing the native library: ${cargoOutput}`,
    );
  }

  copyFileSync(cargoOutput, localOutput);
};

if (!shouldSkipIfNeededBuild()) {
  buildNative();
  console.log(`Built native addon: ${localOutput}`);
}
