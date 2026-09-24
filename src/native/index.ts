import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FormDataEntry } from "#/form-data";
import {
  getNativePackageName,
  type LinuxLibc,
  type NativePlatformKey,
  resolveNativePlatformKey,
} from "#/native/platform-key";

export interface NativeRequestOptions {
  method: string;
  url: string;
  headers: string[];
  body?: string | Buffer;
  form?: FormDataEntry[];
  timeout: number;
  noBody: boolean;
}

export interface NativeResponse {
  transportCode: number;
  transportMessage: string;
  statusCode: number;
  effectiveUrl: string | null;
  redirectUrl: string | null;
  headers: string[];
  body: Buffer;
}

export interface NativeBinding {
  request(options: NativeRequestOptions): NativeResponse;
}

type NativeRequire = (path: string) => NativeBinding;
type NativeResolve = (request: string) => string;
type FileExists = (path: string) => boolean;

interface ProcessReport {
  header?: { glibcVersionRuntime?: string };
}

export interface NativeLoadOptions {
  explicitPath?: string;
  platformKey?: NativePlatformKey;
  packageRoot?: string;
  exists?: FileExists;
  requireNative?: NativeRequire;
  resolveNative?: NativeResolve;
}

const moduleRequire = createRequire(import.meta.url);
const nativeRequire = moduleRequire as NativeRequire;
const nativeResolve = moduleRequire.resolve.bind(moduleRequire);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const findPackageRoot = (
  startDirectory: string,
  exists: FileExists = existsSync,
): string => {
  let currentDirectory = startDirectory;

  while (currentDirectory !== dirname(currentDirectory)) {
    if (exists(join(currentDirectory, "package.json"))) {
      return currentDirectory;
    }
    currentDirectory = dirname(currentDirectory);
  }

  if (exists(join(currentDirectory, "package.json"))) {
    return currentDirectory;
  }

  throw new Error(
    `Unable to locate the sync-request-curl package root from ${startDirectory}`,
  );
};

export const getLinuxLibc = (
  report = process.report?.getReport() as ProcessReport | undefined,
): LinuxLibc => (report?.header?.glibcVersionRuntime ? "gnu" : "musl");

export const getPlatformKey = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  linuxLibc: LinuxLibc = getLinuxLibc(),
): NativePlatformKey => {
  const platformKey = resolveNativePlatformKey(platform, arch, linuxLibc);
  if (platformKey) {
    return platformKey;
  }

  throw new Error(
    `sync-request-curl does not provide a native binary for ${platform}-${arch}`,
  );
};

export const loadFirstExisting = (
  candidates: string[],
  exists: FileExists = existsSync,
  requireNative: NativeRequire = nativeRequire,
): NativeBinding | undefined => {
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return requireNative(candidate);
    }
  }
  return undefined;
};

export const resolveOptionalNativePackage = (
  packageName: string,
  resolveNative: NativeResolve = nativeResolve,
): string | undefined => {
  try {
    return resolveNative(packageName);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "MODULE_NOT_FOUND"
    ) {
      return undefined;
    }
    throw error;
  }
};

export const loadBinding = (options: NativeLoadOptions = {}): NativeBinding => {
  const requireNative = options.requireNative ?? nativeRequire;
  const explicitPath =
    options.explicitPath ?? process.env.SYNC_REQUEST_CURL_NATIVE_PATH;
  if (explicitPath) {
    return requireNative(explicitPath);
  }

  const platformKey = options.platformKey ?? getPlatformKey();
  const currentPackageRoot =
    options.packageRoot ?? findPackageRoot(moduleDirectory);
  const localBuildDirectory = join(currentPackageRoot, "native", "build");
  const prebuildDirectory = join(currentPackageRoot, "prebuilds");
  const localBinding = loadFirstExisting(
    [
      join(localBuildDirectory, "sync_request_curl_native.node"),
      join(prebuildDirectory, `sync_request_curl_native.${platformKey}.node`),
    ],
    options.exists,
    requireNative,
  );

  if (localBinding) {
    return localBinding;
  }

  const nativePackageName = getNativePackageName(platformKey);
  const nativePackagePath = resolveOptionalNativePackage(
    nativePackageName,
    options.resolveNative,
  );
  if (nativePackagePath) {
    return requireNative(nativePackagePath);
  }

  throw new Error(
    `Unable to load the sync-request-curl native binary for ${platformKey}. ` +
      `The optional package ${nativePackageName} is missing. Reinstall sync-request-curl with optional dependencies enabled.`,
  );
};

export default loadBinding();
