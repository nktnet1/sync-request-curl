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

export const supportedLinuxLibcs = ["gnu", "musl"] as const;

export type NativePlatformKey = (typeof supportedPlatformKeys)[number];
export type LinuxLibc = (typeof supportedLinuxLibcs)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getLinuxLibcFromReport = (report: unknown): LinuxLibc => {
  if (!isRecord(report)) {
    return "musl";
  }

  const { header } = report;
  if (!isRecord(header)) {
    return "musl";
  }

  return typeof header.glibcVersionRuntime === "string" &&
    header.glibcVersionRuntime.length > 0
    ? "gnu"
    : "musl";
};

export const getNativePackageName = (platform: NativePlatformKey): string =>
  `@nktnet/sync-request-curl-${platform}`;

export function isNativePlatformKey(value: string): value is NativePlatformKey {
  return supportedPlatformKeys.some((platform) => platform === value);
}

export function resolveNativePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
  linuxLibc: LinuxLibc,
): NativePlatformKey | undefined {
  if (arch !== "x64" && arch !== "arm64") {
    return undefined;
  }

  switch (platform) {
    case "darwin":
      return `darwin-${arch}`;
    case "linux":
      return `linux-${arch}-${linuxLibc}`;
    case "win32":
      return `win32-${arch}-msvc`;
    default:
      return undefined;
  }
}
