import * as v from "valibot";

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

export const nativePlatformKeySchema = v.picklist(supportedPlatformKeys);
export const linuxLibcSchema = v.picklist(["gnu", "musl"] as const);
const architectureSchema = v.picklist(["x64", "arm64"] as const);

export type NativePlatformKey = v.InferOutput<typeof nativePlatformKeySchema>;
export type LinuxLibc = v.InferOutput<typeof linuxLibcSchema>;

export const getNativePackageName = (platform: NativePlatformKey): string =>
  `@nktnet/sync-request-curl-${platform}`;

export function isNativePlatformKey(value: string): value is NativePlatformKey {
  return v.is(nativePlatformKeySchema, value);
}

export function resolveNativePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
  linuxLibc: LinuxLibc,
): NativePlatformKey | undefined {
  const parsedArch = v.safeParse(architectureSchema, arch);
  if (!parsedArch.success) {
    return undefined;
  }

  switch (platform) {
    case "darwin":
      return `darwin-${parsedArch.output}`;
    case "linux":
      return `linux-${parsedArch.output}-${linuxLibc}`;
    case "win32":
      return `win32-${parsedArch.output}-msvc`;
    default:
      return undefined;
  }
}
