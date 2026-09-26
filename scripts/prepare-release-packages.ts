import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  getNativePackageName,
  type NativePlatformKey,
  supportedPlatformKeys,
} from "#/native/platform-key";
import { getPrebuildFilename } from "#scripts/native-platform";

interface PackageJson extends Record<string, unknown> {
  name: string;
  version: string;
  description?: string;
  repository?: unknown;
  license?: string;
  author?: unknown;
  engines?: Record<string, string>;
}

interface NativeTarget {
  os: NodeJS.Platform;
  cpu: "arm64" | "x64";
  libc?: "glibc" | "musl";
}

const nativeTargets: Record<NativePlatformKey, NativeTarget> = {
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "linux-arm64-gnu": { os: "linux", cpu: "arm64", libc: "glibc" },
  "linux-arm64-musl": { os: "linux", cpu: "arm64", libc: "musl" },
  "linux-x64-gnu": { os: "linux", cpu: "x64", libc: "glibc" },
  "linux-x64-musl": { os: "linux", cpu: "x64", libc: "musl" },
  "win32-arm64-msvc": { os: "win32", cpu: "arm64" },
  "win32-x64-msvc": { os: "win32", cpu: "x64" },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

const isPackageJson = (value: unknown): value is PackageJson => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    (value.description === undefined ||
      typeof value.description === "string") &&
    (value.license === undefined || typeof value.license === "string") &&
    (value.engines === undefined || isStringRecord(value.engines))
  );
};

const parsePackageJson = (source: string): PackageJson => {
  const value: unknown = JSON.parse(source);
  if (!isPackageJson(value)) {
    throw new TypeError("package.json is missing required package metadata");
  }
  return value;
};

const root = resolve(import.meta.dirname, "..");
const releaseRoot = join(root, ".release");
const mainOutput = join(releaseRoot, "main");
const nativeOutput = join(releaseRoot, "native");
const prebuilds = join(root, "prebuilds");
const packageJson = parsePackageJson(
  readFileSync(join(root, "package.json"), "utf8"),
);

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const copyCommonFiles = (output: string): void => {
  cpSync(join(root, "LICENSE"), join(output, "LICENSE"));
};

const optionalDependencies = Object.fromEntries(
  supportedPlatformKeys.map((platform) => [
    getNativePackageName(platform),
    packageJson.version,
  ]),
);

const prepareMainPackage = (): void => {
  mkdirSync(mainOutput, { recursive: true });
  cpSync(join(root, "dist"), join(mainOutput, "dist"), { recursive: true });
  cpSync(join(root, "README.md"), join(mainOutput, "README.md"));
  copyCommonFiles(mainOutput);

  const manifest: Record<string, unknown> = {
    ...packageJson,
    files: ["dist"],
    optionalDependencies,
  };

  delete manifest.devDependencies;
  delete manifest.imports;
  delete manifest.packageManager;
  delete manifest.scripts;

  writeJson(join(mainOutput, "package.json"), manifest);
};

const prepareNativePackage = (platform: NativePlatformKey): void => {
  const input = join(prebuilds, getPrebuildFilename(platform));
  if (!existsSync(input) || statSync(input).size === 0) {
    throw new Error(`Missing native prebuild: ${input}`);
  }

  const target = nativeTargets[platform];
  const output = join(nativeOutput, platform);
  mkdirSync(output, { recursive: true });
  cpSync(input, join(output, "sync_request_curl_native.node"));
  copyCommonFiles(output);

  const manifest: Record<string, unknown> = {
    name: getNativePackageName(platform),
    version: packageJson.version,
    description: `Native Node-API binary for ${packageJson.name} (${platform}).`,
    repository: packageJson.repository,
    license: packageJson.license,
    author: packageJson.author,
    engines: packageJson.engines,
    os: [target.os],
    cpu: [target.cpu],
    main: "./sync_request_curl_native.node",
    files: ["sync_request_curl_native.node"],
    publishConfig: { access: "public" },
  };

  if (target.libc) {
    manifest.libc = target.libc;
  }

  writeJson(join(output, "package.json"), manifest);
  writeFileSync(
    join(output, "README.md"),
    `# ${getNativePackageName(platform)}\n\n` +
      `Platform-specific native binary for \`${packageJson.name}\`. ` +
      `Install \`${packageJson.name}\` instead of depending on this package directly.\n`,
  );
};

if (!existsSync(join(root, "dist"))) {
  throw new Error("Missing dist/. Run the JavaScript build before packaging.");
}

rmSync(releaseRoot, { recursive: true, force: true });
prepareMainPackage();
for (const platform of supportedPlatformKeys) {
  prepareNativePackage(platform);
}

console.log(
  `Prepared ${packageJson.name}@${packageJson.version} and ${supportedPlatformKeys.length} native packages in .release/.`,
);
