export const supportedPlatformKeys = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-arm64-msvc",
  "win32-x64-msvc",
] as const;

export type NativePlatformKey = (typeof supportedPlatformKeys)[number];
export type LinuxLibc = "gnu" | "musl";

export const getLinuxLibc = (): LinuxLibc => {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
};

export const isNativePlatformKey = (
  value: string,
): value is NativePlatformKey =>
  supportedPlatformKeys.some((candidate) => candidate === value);

export const getCurrentPlatformKey = (): NativePlatformKey => {
  const { platform, arch } = process;

  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    return `darwin-${arch}`;
  }

  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    return `linux-${arch}-${getLinuxLibc()}`;
  }

  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    return `win32-${arch}-msvc`;
  }

  throw new Error(`Unsupported native platform: ${platform}-${arch}`);
};

export const getPrebuildFilename = (platform: NativePlatformKey): string =>
  `sync_request_curl_native.${platform}.node`;
