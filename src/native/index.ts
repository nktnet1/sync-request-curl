import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import { preparedFormDataEntrySchema } from "#/form-data";
import {
  getLinuxLibcFromReport,
  getNativePackageName,
  type LinuxLibc,
  type NativePlatformKey,
  resolveNativePlatformKey,
} from "#/native/platform-key";
import { uppercaseHttpVerbSchema } from "#/validation";

export const nativeRequestOptionsSchema = v.object({
  method: uppercaseHttpVerbSchema,
  url: v.string(),
  headers: v.array(v.string()),
  body: v.optional(v.union([v.string(), v.instance(Buffer)])),
  form: v.optional(v.array(preparedFormDataEntrySchema)),
  timeout: v.number(),
  socketTimeout: v.number(),
  noBody: v.boolean(),
  connectionPoolId: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export type NativeRequestOptions = v.InferOutput<
  typeof nativeRequestOptionsSchema
>;

const nativeResponseObjectSchema = v.object({
  transportCode: v.pipe(v.number(), v.integer()),
  transportMessage: v.string(),
  statusCode: v.pipe(v.number(), v.integer()),
  effectiveUrl: v.nullable(v.string()),
  redirectUrl: v.nullable(v.string()),
  headers: v.array(v.string()),
  body: v.instance(Buffer),
});

export const nativeResponseSchema = v.custom<
  v.InferOutput<typeof nativeResponseObjectSchema>
>(
  (input) => v.is(nativeResponseObjectSchema, input),
  "Native addon returned an invalid response",
);

export type NativeResponse = v.InferOutput<typeof nativeResponseSchema>;

export interface NativeBinding {
  request(options: NativeRequestOptions): NativeResponse;
  createConnectionPool(maxConnections: number): number;
  releaseConnectionPool(poolId: number): void;
}

type NativeRequire = (path: string) => NativeBinding;
type NativeResolve = (request: string) => string;
type FileExists = (path: string) => boolean;

export interface NativeLoadOptions {
  explicitPath?: string;
  platformKey?: NativePlatformKey;
  packageRoot?: string;
  exists?: FileExists;
  requireNative?: NativeRequire;
  resolveNative?: NativeResolve;
}

const moduleNotFoundErrorSchema = v.object({
  code: v.literal("MODULE_NOT_FOUND"),
});

const rawNativeBindingObjectSchema = v.object({
  request: v.function(),
  createConnectionPool: v.function(),
  releaseConnectionPool: v.function(),
});
const rawNativeBindingSchema = v.custom<
  v.InferOutput<typeof rawNativeBindingObjectSchema>
>(
  (input) => v.is(rawNativeBindingObjectSchema, input),
  "Native addon must export request(), createConnectionPool(), and releaseConnectionPool()",
);
const parseNativeBinding = (input: unknown): NativeBinding => {
  const binding = v.parse(rawNativeBindingSchema, input);
  return {
    request: (options) =>
      v.parse(nativeResponseSchema, binding.request(options)),
    createConnectionPool: (maxConnections) =>
      v.parse(
        v.pipe(v.number(), v.integer(), v.minValue(1)),
        binding.createConnectionPool(maxConnections),
      ),
    releaseConnectionPool: (poolId) => {
      binding.releaseConnectionPool(poolId);
    },
  };
};

const moduleRequire = createRequire(import.meta.url);
const nativeRequire: NativeRequire = (path) =>
  parseNativeBinding(moduleRequire(path));
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
  report: unknown = process.report?.getReport(),
): LinuxLibc => getLinuxLibcFromReport(report);

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
    if (v.is(moduleNotFoundErrorSchema, error)) {
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
