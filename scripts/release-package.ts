import {
  getNativePackageName,
  getNativeTarget,
  type NativePlatformKey,
} from "#/native/platform-key-core";

export interface ReleasePackageJson extends Record<string, unknown> {
  name: string;
  version: string;
  description?: string;
  repository?: unknown;
  license?: string;
  author?: unknown;
  engines?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

const isReleasePackageJson = (value: unknown): value is ReleasePackageJson => {
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

export const parseReleasePackageJson = (source: string): ReleasePackageJson => {
  const value: unknown = JSON.parse(source);
  if (!isReleasePackageJson(value)) {
    throw new TypeError("package.json is missing required package metadata");
  }
  return value;
};

export const createMainPackageManifest = (
  packageJson: ReleasePackageJson,
  optionalDependencies: Record<string, string>,
): Record<string, unknown> => {
  const manifest: Record<string, unknown> = {
    ...packageJson,
    files: ["dist"],
    optionalDependencies,
  };

  delete manifest.devDependencies;
  delete manifest.imports;
  delete manifest.packageManager;
  delete manifest.scripts;
  return manifest;
};

export const createNativePackageManifest = (
  packageJson: ReleasePackageJson,
  platform: NativePlatformKey,
): Record<string, unknown> => {
  const target = getNativeTarget(platform);
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
  return manifest;
};
