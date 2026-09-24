import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type LinuxLibc,
  resolveNativePlatformKey,
} from "#/native-platform-key";
import type { HttpPostField } from "#/types";

export interface NativeCurlOptions {
  proxy?: string;
  proxyUserPwd?: string;
  userAgent?: string;
  referer?: string;
  caInfo?: string;
  interface?: string;
  dnsServers?: string;
  tcpKeepAlive?: boolean;
}

export interface NativeRequestOptions {
  method: string;
  url: string;
  headers: string[];
  body?: string | Buffer;
  formData?: HttpPostField[];
  timeout: number;
  insecure: boolean;
  noBody: boolean;
  curlOptions?: NativeCurlOptions;
}

export interface NativeResponse {
  code: number;
  errorMessage: string;
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
type FileExists = (path: string) => boolean;

interface ProcessReport {
  header?: { glibcVersionRuntime?: string };
}

export interface NativeLoadOptions {
  explicitPath?: string;
  platformKey?: string;
  moduleDirectory?: string;
  exists?: FileExists;
  requireNative?: NativeRequire;
}

const nativeRequire = createRequire(import.meta.url) as NativeRequire;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const getLinuxLibc = (
  report = process.report?.getReport() as ProcessReport | undefined,
): LinuxLibc => (report?.header?.glibcVersionRuntime ? "gnu" : "musl");

export const getPlatformKey = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  linuxLibc: LinuxLibc = getLinuxLibc(),
): string => {
  const platformKey = resolveNativePlatformKey(platform, arch, linuxLibc);
  if (platformKey) return platformKey;

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

export const loadBinding = (options: NativeLoadOptions = {}): NativeBinding => {
  const requireNative = options.requireNative ?? nativeRequire;
  const explicitPath =
    options.explicitPath ?? process.env.SYNC_REQUEST_CURL_NATIVE_PATH;
  if (explicitPath) {
    return requireNative(explicitPath);
  }

  const platformKey = options.platformKey ?? getPlatformKey();
  const currentModuleDirectory = options.moduleDirectory ?? moduleDirectory;
  const localBuildDirectory = join(
    currentModuleDirectory,
    "..",
    "native",
    "build",
  );
  const prebuildDirectory = join(currentModuleDirectory, "..", "prebuilds");
  const binding = loadFirstExisting(
    [
      join(localBuildDirectory, "sync_request_curl_native.node"),
      join(localBuildDirectory, "Release", "sync_request_curl_native.node"),
      join(prebuildDirectory, `sync_request_curl_native.${platformKey}.node`),
    ],
    options.exists,
    requireNative,
  );

  if (binding) {
    return binding;
  }

  throw new Error(
    `Unable to load the sync-request-curl native binary for ${platformKey}. ` +
      "The published package should include this prebuilt Node-API addon; no install-time build fallback is used.",
  );
};

export default loadBinding();
