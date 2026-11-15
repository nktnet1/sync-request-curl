import { describe, expect, test } from "vitest";
import {
  getLinuxLibcFromReport,
  getNativePackageName,
  getNativeTarget,
  isNativePlatformKey,
  resolveNativePlatformKey,
} from "#/native/platform-key-core";

describe("native platform key suffixes", () => {
  test.each([
    ["linux", "x64", "gnu", "linux-x64-gnu"],
    ["linux", "arm64", "musl", "linux-arm64-musl"],
    ["win32", "x64", "gnu", "win32-x64-msvc"],
    ["win32", "arm64", "musl", "win32-arm64-msvc"],
    ["freebsd", "arm64", "gnu", "freebsd-arm64"],
    ["darwin", "arm64", "musl", "darwin-arm64"],
  ] as const)("resolves %s/%s/%s", (platform, arch, libc, expected) => {
    expect(resolveNativePlatformKey(platform, arch, libc)).toBe(expected);
  });

  test("detects libc from a supplied process report", () => {
    expect(getLinuxLibcFromReport(null)).toBe("musl");
    expect(getLinuxLibcFromReport({})).toBe("musl");
    expect(getLinuxLibcFromReport({ header: null })).toBe("musl");
    expect(getLinuxLibcFromReport({ header: {} })).toBe("musl");
    expect(getLinuxLibcFromReport({ header: { glibcVersionRuntime: 3 } })).toBe(
      "musl",
    );
    expect(
      getLinuxLibcFromReport({ header: { glibcVersionRuntime: "" } }),
    ).toBe("musl");
    expect(
      getLinuxLibcFromReport({ header: { glibcVersionRuntime: "2.38" } }),
    ).toBe("gnu");
  });

  test("maps a native platform key to package name and target", () => {
    expect(isNativePlatformKey("linux-x64-gnu")).toBe(true);
    expect(isNativePlatformKey("linux-x64-invalid")).toBe(false);
    expect(getNativePackageName("linux-x64-gnu")).toBe(
      "@nktnet/sync-request-curl-linux-x64-gnu",
    );
    expect(getNativeTarget("linux-x64-gnu")).toEqual({
      os: "linux",
      cpu: "x64",
      libc: "glibc",
    });
  });

  test("does not invent packages for unsupported architectures", () => {
    expect(resolveNativePlatformKey("linux", "ia32", "gnu")).toBeUndefined();
    expect(resolveNativePlatformKey("win32", "armv7", "gnu")).toBeUndefined();
  });
});
