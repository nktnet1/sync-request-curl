import {
  isNativePlatformKey,
  type LinuxLibc,
  type NativePlatformKey,
  resolveNativePlatformKey,
  supportedPlatformKeys,
} from "#native-platform-key";

export type { LinuxLibc, NativePlatformKey };
export { isNativePlatformKey, supportedPlatformKeys };

export const getLinuxLibc = (): LinuxLibc => {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
};

export const getCurrentPlatformKey = (): NativePlatformKey => {
  const { platform, arch } = process;
  const platformKey = resolveNativePlatformKey(platform, arch, getLinuxLibc());
  if (platformKey) return platformKey;

  throw new Error(`Unsupported native platform: ${platform}-${arch}`);
};

export const getPrebuildFilename = (platform: NativePlatformKey): string =>
  `sync_request_curl_native.${platform}.node`;
