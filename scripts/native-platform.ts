import * as v from "valibot";
import {
  type LinuxLibc,
  linuxLibcSchema,
  type NativePlatformKey,
  nativePlatformKeySchema,
  resolveNativePlatformKey,
} from "#/native/platform-key";

export type { LinuxLibc, NativePlatformKey } from "#/native/platform-key";
export { supportedPlatformKeys } from "#/native/platform-key";

const processReportSchema = v.object({
  header: v.optional(
    v.object({
      glibcVersionRuntime: v.optional(v.string()),
    }),
  ),
});

export const parseLinuxLibc = (value: unknown): LinuxLibc =>
  v.parse(linuxLibcSchema, value);

export const parseNativePlatformKey = (value: unknown): NativePlatformKey =>
  v.parse(nativePlatformKeySchema, value);

export const getLinuxLibc = (): LinuxLibc => {
  const report = v.safeParse(processReportSchema, process.report?.getReport());
  return report.success && report.output.header?.glibcVersionRuntime
    ? "gnu"
    : "musl";
};

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
