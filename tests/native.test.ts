import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  getLinuxLibc,
  getPlatformKey,
  loadBinding,
  loadFirstExisting,
  type NativeBinding,
} from "#/native";

const fakeBinding = (): NativeBinding => ({
  request: vi.fn(() => {
    throw new Error("not used");
  }),
});

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
});

describe("native binding loading", () => {
  test("loads the first existing candidate", () => {
    const binding = fakeBinding();
    const requireNative = vi.fn(() => binding);
    const exists = vi.fn((path: string) => path === "/second.node");

    expect(
      loadFirstExisting(
        ["/first.node", "/second.node", "/third.node"],
        exists,
        requireNative,
      ),
    ).toBe(binding);
    expect(requireNative).toHaveBeenCalledOnce();
    expect(requireNative).toHaveBeenCalledWith("/second.node");
  });

  test("returns undefined when no candidate exists", () => {
    expect(loadFirstExisting(["/missing.node"], () => false, vi.fn())).toBe(
      undefined,
    );
  });

  test("honours an explicit native path", () => {
    const binding = fakeBinding();
    const requireNative = vi.fn(() => binding);

    expect(
      loadBinding({
        explicitPath: "/custom/native.node",
        requireNative,
      }),
    ).toBe(binding);
    expect(requireNative).toHaveBeenCalledWith("/custom/native.node");
  });

  test("loads the matching prebuild when local outputs are missing", () => {
    const binding = fakeBinding();
    const requireNative = vi.fn(() => binding);
    const root = join("", "package", "src");
    const expected = join(
      "",
      "package",
      "prebuilds",
      "sync_request_curl_native.linux-x64-musl.node",
    );

    expect(
      loadBinding({
        platformKey: "linux-x64-musl",
        moduleDirectory: root,
        exists: (candidate) => candidate === expected,
        requireNative,
      }),
    ).toBe(binding);
    expect(requireNative).toHaveBeenCalledWith(expected);
  });

  test("throws a useful error when no matching binary exists", () => {
    expect(() =>
      loadBinding({
        platformKey: "linux-arm64-musl",
        moduleDirectory: join("", "package", "src"),
        exists: () => false,
        requireNative: vi.fn(),
      }),
    ).toThrow(
      "Unable to load the sync-request-curl native binary for linux-arm64-musl",
    );
  });
});
