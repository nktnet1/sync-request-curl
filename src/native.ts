import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HttpPostField } from "./types";

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

interface NativeBinding {
  request(options: NativeRequestOptions): NativeResponse;
}

const nativeRequire = createRequire(import.meta.url);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

const getLinuxLibc = (): "gnu" | "musl" => {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
};

const getPlatformKey = (): string => {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    return `darwin-${arch}`;
  }

  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    return `linux-${arch}-${getLinuxLibc()}`;
  }

  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    return `win32-${arch}-msvc`;
  }

  throw new Error(
    `sync-request-curl does not provide a native binary for ${platform}-${arch}`,
  );
};

const loadFirstExisting = (candidates: string[]): NativeBinding | undefined => {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return nativeRequire(candidate) as NativeBinding;
    }
  }
  return undefined;
};

const loadBinding = (): NativeBinding => {
  const explicitPath = process.env.SYNC_REQUEST_CURL_NATIVE_PATH;
  if (explicitPath) {
    return nativeRequire(explicitPath) as NativeBinding;
  }

  const platformKey = getPlatformKey();
  const localBuildDirectory = join(moduleDirectory, "..", "native", "build");
  const prebuildDirectory = join(moduleDirectory, "..", "prebuilds");
  const binding = loadFirstExisting([
    join(localBuildDirectory, "sync_request_curl_native.node"),
    join(localBuildDirectory, "Release", "sync_request_curl_native.node"),
    join(
      prebuildDirectory,
      `sync_request_curl_native.${platformKey}.node`,
    ),
  ]);

  if (binding) {
    return binding;
  }

  throw new Error(
    `Unable to load the sync-request-curl native binary for ${platformKey}. ` +
      "The published package should include this prebuilt Node-API addon; no install-time build fallback is used.",
  );
};

export default loadBinding();
