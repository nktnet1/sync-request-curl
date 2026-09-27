import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  getNativePackageName,
  type NativePlatformKey,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import { getCurrentPlatformKey } from "#scripts/native-platform";
import { run } from "#scripts/process";

interface PackageJson {
  version: string;
}

interface InstallTarget {
  os: NodeJS.Platform;
  cpu: "arm64" | "x64";
  libc?: "glibc" | "musl";
}

const installTargets: Record<NativePlatformKey, InstallTarget> = {
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "linux-arm64-gnu": { os: "linux", cpu: "arm64", libc: "glibc" },
  "linux-arm64-musl": { os: "linux", cpu: "arm64", libc: "musl" },
  "linux-x64-gnu": { os: "linux", cpu: "x64", libc: "glibc" },
  "linux-x64-musl": { os: "linux", cpu: "x64", libc: "musl" },
  "win32-arm64-msvc": { os: "win32", cpu: "arm64" },
  "win32-x64-msvc": { os: "win32", cpu: "x64" },
};

const { values } = parseArgs({
  options: {
    matrix: { type: "boolean", default: false },
    registry: { type: "string" },
    version: { type: "string" },
  },
});

const registry = values.registry;
if (!registry) {
  throw new Error("--registry is required");
}

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as PackageJson;
const version = values.version ?? packageJson.version;
const temporaryRoot = mkdtempSync(
  join(tmpdir(), "sync-request-curl-registry-smoke-"),
);

const installPackage = (directory: string, target?: InstallTarget): void => {
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );

  const args = [
    "install",
    `sync-request-curl@${version}`,
    "--registry",
    registry,
    "--ignore-scripts",
    "--package-lock=false",
  ];
  if (target) {
    args.push("--os", target.os, "--cpu", target.cpu);
    if (target.libc) {
      args.push("--libc", target.libc);
    }
  }
  run("npm", args, { cwd: directory });
};

const verifyNativeSelection = (
  directory: string,
  expectedPlatform: NativePlatformKey,
): void => {
  const scopeDirectory = join(directory, "node_modules", "@nktnet");
  const installedNativePackages = existsSync(scopeDirectory)
    ? readdirSync(scopeDirectory).sort()
    : [];
  const expectedNativePackage = getNativePackageName(expectedPlatform);
  const expectedDirectoryName = expectedNativePackage.slice("@nktnet/".length);

  if (
    installedNativePackages.length !== 1 ||
    installedNativePackages[0] !== expectedDirectoryName
  ) {
    throw new Error(
      `Expected only ${expectedNativePackage}, installed: ${installedNativePackages.join(", ") || "none"}`,
    );
  }

  const binary = join(
    scopeDirectory,
    expectedDirectoryName,
    "sync_request_curl_native.node",
  );
  if (!existsSync(binary)) {
    throw new Error(`Missing native binary in ${expectedNativePackage}`);
  }
};

try {
  if (values.matrix) {
    for (const platform of supportedPlatformKeys) {
      const directory = join(temporaryRoot, platform);
      mkdirSync(directory, { recursive: true });
      installPackage(directory, installTargets[platform]);
      verifyNativeSelection(directory, platform);
      console.log(`Verified optional dependency selection for ${platform}`);
    }
  }

  const currentPlatform = getCurrentPlatformKey();
  const currentDirectory = join(temporaryRoot, "current-platform");
  mkdirSync(currentDirectory, { recursive: true });
  installPackage(currentDirectory);
  verifyNativeSelection(currentDirectory, currentPlatform);

  const commonJsSmokeScript = [
    'const request = require("sync-request-curl");',
    'if (typeof request !== "function") throw new TypeError("Expected CommonJS default export to be a function");',
    'console.log("Loaded CommonJS package and native binding successfully");',
  ].join("\n");
  run("node", ["-e", commonJsSmokeScript], { cwd: currentDirectory });

  const esmSmokeScript = [
    'import request from "sync-request-curl";',
    'if (typeof request !== "function") throw new TypeError("Expected ESM default export to be a function");',
    'console.log("Loaded ESM package and native binding successfully");',
  ].join("\n");
  run("node", ["--input-type=module", "-e", esmSmokeScript], {
    cwd: currentDirectory,
  });

  console.log(
    `Verified sync-request-curl@${version} from ${registry} with ${getNativePackageName(currentPlatform)}`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
