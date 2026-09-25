import * as v from "valibot";
import {
  getLinuxLibcFromReport,
  type LinuxLibc,
  linuxLibcSchema,
  type NativePlatformKey,
  nativePlatformKeySchema,
  resolveNativePlatformKey,
} from "#/native/platform-key";

export type { LinuxLibc, NativePlatformKey } from "#/native/platform-key";
export { supportedPlatformKeys } from "#/native/platform-key";

export const parseLinuxLibc = (value: unknown): LinuxLibc =>
  v.parse(linuxLibcSchema, value);

export const parseNativePlatformKey = (value: unknown): NativePlatformKey =>
  v.parse(nativePlatformKeySchema, value);

export const getLinuxLibc = (): LinuxLibc =>
  getLinuxLibcFromReport(process.report?.getReport());

export const getCurrentPlatformKey = (): NativePlatformKey => {
  const { platform, arch } = process;
  const platformKey = resolveNativePlatformKey(platform, arch, getLinuxLibc());
  if (platformKey) {
    return platformKey;
  }

  throw new Error(`Unsupported native platform: ${platform}-${arch}`);
};

export const getPrebuildFilename = (platform: NativePlatformKey): string =>
  `sync_request_curl_native.${platform}.node`;
