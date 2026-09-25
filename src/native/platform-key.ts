import * as v from "valibot";
import {
  getLinuxLibcFromReport as getLinuxLibcFromReportCore,
  getNativePackageName as getNativePackageNameCore,
  isNativePlatformKey as isNativePlatformKeyCore,
  supportedPlatformKeys as platformKeys,
  resolveNativePlatformKey as resolveNativePlatformKeyCore,
  supportedLinuxLibcs,
} from "#/native/platform-key-core";

export const nativePlatformKeySchema = v.picklist(platformKeys);
export const linuxLibcSchema = v.picklist(supportedLinuxLibcs);

export const supportedPlatformKeys = nativePlatformKeySchema.options;
export type NativePlatformKey = v.InferOutput<typeof nativePlatformKeySchema>;
export type LinuxLibc = v.InferOutput<typeof linuxLibcSchema>;

export const getLinuxLibcFromReport = (report: unknown): LinuxLibc =>
  getLinuxLibcFromReportCore(report);

export const getNativePackageName = (platform: NativePlatformKey): string =>
  getNativePackageNameCore(platform);

export function isNativePlatformKey(value: string): value is NativePlatformKey {
  return isNativePlatformKeyCore(value);
}

export const resolveNativePlatformKey: (
  platform: NodeJS.Platform,
  arch: string,
  linuxLibc: LinuxLibc,
) => NativePlatformKey | undefined = resolveNativePlatformKeyCore;
