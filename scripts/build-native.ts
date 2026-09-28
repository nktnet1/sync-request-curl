import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveNativePlatformKey } from "#/native/platform-key-core";
import { getLinuxLibc, getPrebuildFilename } from "#scripts/native-platform";
import { run } from "#scripts/process";

const root = resolve(import.meta.dirname, "..");
const nativeDir = join(root, "native");
const buildDir = join(nativeDir, "build");
const localOutput = join(buildDir, "sync_request_curl_native.node");
const cliArgs = process.argv.slice(2);
const ifNeeded = new Set(cliArgs).has("--if-needed");
const nativeBuildArgs = cliArgs.filter(
  (argument) => argument !== "--if-needed",
);

mkdirSync(buildDir, { recursive: true });

const listNativeSources = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "build" ||
      entry.name === "build.mjs" ||
      entry.name === "target"
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listNativeSources(path));
    } else {
      files.push(path);
    }
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

const matchingPrebuild = (): string | undefined => {
  const key = resolveNativePlatformKey(
    process.platform,
    process.arch,
    getLinuxLibc(),
  );
  return key ? join(root, "prebuilds", getPrebuildFilename(key)) : undefined;
};

const shouldSkipIfNeededBuild = (): boolean => {
  if (!ifNeeded || nativeBuildArgs.length > 0) {
    return false;
  }

  if (existsSync(localOutput)) {
    if (localBuildIsStale()) {
      return false;
    }
    console.log(`Native addon is up to date: ${localOutput}`);
    return true;
  }

  const prebuild = matchingPrebuild();
  if (prebuild && existsSync(prebuild)) {
    console.log(`Using matching native prebuild: ${prebuild}`);
    return true;
  }

  return false;
};

if (!shouldSkipIfNeededBuild()) {
  run(process.execPath, [join(nativeDir, "build.ts"), ...nativeBuildArgs], {
    cwd: root,
  });
}
