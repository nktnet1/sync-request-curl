import { describe, expect, test } from "vitest";
import { getLinuxLibc, getPlatformKey } from "#/native/index";
import {
  getNativePackageName,
  isNativePlatformKey,
} from "#/native/platform-key";

describe("native platform detection", () => {
  test("detects glibc and musl reports", () => {
    expect(getLinuxLibc({ header: { glibcVersionRuntime: "2.31" } })).toBe(
      "gnu",
    );
    expect(getLinuxLibc({ header: {} })).toBe("musl");
    expect(getLinuxLibc({})).toBe("musl");
  });

  test.each([
    ["darwin", "x64", "gnu", "darwin-x64"],
    ["darwin", "arm64", "gnu", "darwin-arm64"],
    ["linux", "x64", "gnu", "linux-x64-gnu"],
    ["linux", "arm64", "musl", "linux-arm64-musl"],
    ["win32", "x64", "gnu", "win32-x64-msvc"],
    ["win32", "arm64", "gnu", "win32-arm64-msvc"],
  ] as const)(
    "maps %s-%s to its prebuild key",
    (platform, arch, libc, expected) => {
      expect(getPlatformKey(platform, arch, libc)).toBe(expected);
    },
  );

  test("rejects unsupported platforms and architectures", () => {
    expect(() => getPlatformKey("freebsd", "x64", "gnu")).toThrow(
      "sync-request-curl does not provide a native binary for freebsd-x64",
    );
    expect(() => getPlatformKey("linux", "ia32", "gnu")).toThrow(
      "sync-request-curl does not provide a native binary for linux-ia32",
    );
  });

  test("validates native platform keys", () => {
    expect(isNativePlatformKey("linux-x64-gnu")).toBe(true);
    expect(isNativePlatformKey("linux-x64-unknown")).toBe(false);
  });

  test("maps platform keys to optional native package names", () => {
    expect(getNativePackageName("linux-x64-gnu")).toBe(
      "@nktnet/sync-request-curl-linux-x64-gnu",
    );
  });
});
