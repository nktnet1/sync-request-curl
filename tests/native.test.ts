import { join, parse, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  findPackageRoot,
  getLinuxLibc,
  getPlatformKey,
  loadBinding,
  loadFirstExisting,
  type NativeBinding,
  resolveOptionalNativePackage,
} from "#/native";
import {
  getNativePackageName,
  isNativePlatformKey,
} from "#/native/platform-key";

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

describe("native binding loading", () => {
  test("finds the package root from a nested source directory", () => {
    const root = join("", "package");
    const packageJson = join(root, "package.json");

    expect(
      findPackageRoot(
        join(root, "src", "native"),
        (candidate) => candidate === packageJson,
      ),
    ).toBe(root);
  });

  test("finds a package rooted at the filesystem root", () => {
    const root = parse(resolve(".")).root;
    const packageJson = join(root, "package.json");

    expect(
      findPackageRoot(root, (candidate) => candidate === packageJson),
    ).toBe(root);
  });

  test("throws when no package root can be found", () => {
    const root = parse(resolve(".")).root;

    expect(() => findPackageRoot(join(root, "missing"), () => false)).toThrow(
      "Unable to locate the sync-request-curl package root",
    );
  });

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
    expect(
      loadFirstExisting(["/missing.node"], () => false, vi.fn()),
    ).toBeUndefined();
  });

  test("resolves an installed optional native package", () => {
    const resolveNative = vi.fn(() => "/node_modules/native/addon.node");

    expect(
      resolveOptionalNativePackage(
        "@nktnet/sync-request-curl-linux-x64-gnu",
        resolveNative,
      ),
    ).toBe("/node_modules/native/addon.node");
  });

  test("returns undefined when the optional native package is missing", () => {
    const error = Object.assign(new Error("missing"), {
      code: "MODULE_NOT_FOUND",
    });

    expect(
      resolveOptionalNativePackage(
        "@nktnet/sync-request-curl-linux-x64-gnu",
        () => {
          throw error;
        },
      ),
    ).toBeUndefined();
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

  test("prefers the package-local build output over a matching prebuild", () => {
    const binding = fakeBinding();
    const requireNative = vi.fn(() => binding);
    const root = join("", "package");
    const localBuild = join(
      root,
      "native",
      "build",
      "sync_request_curl_native.node",
    );
    const prebuild = join(
      root,
      "prebuilds",
      "sync_request_curl_native.linux-x64-musl.node",
    );

    expect(
      loadBinding({
        platformKey: "linux-x64-musl",
        packageRoot: root,
        exists: (candidate) =>
          candidate === localBuild || candidate === prebuild,
        requireNative,
      }),
    ).toBe(binding);
    expect(requireNative).toHaveBeenCalledWith(localBuild);
  });

  test("loads the matching prebuild when local outputs are missing", () => {
    const binding = fakeBinding();
    const requireNative = vi.fn(() => binding);
    const root = join("", "package");
    const expected = join(
      root,
      "prebuilds",
      "sync_request_curl_native.linux-x64-musl.node",
    );

    expect(
      loadBinding({
        platformKey: "linux-x64-musl",
        packageRoot: root,
        exists: (candidate) => candidate === expected,
        requireNative,
      }),
    ).toBe(binding);
    expect(requireNative).toHaveBeenCalledWith(expected);
  });

  test("loads the matching optional native package when local outputs are missing", () => {
    const binding = fakeBinding();
    const requireNative = vi.fn(() => binding);
    const resolved = join("", "node_modules", "native", "addon.node");
    const resolveNative = vi.fn(() => resolved);

    expect(
      loadBinding({
        platformKey: "linux-x64-gnu",
        packageRoot: join("", "package"),
        exists: () => false,
        requireNative,
        resolveNative,
      }),
    ).toBe(binding);
    expect(resolveNative).toHaveBeenCalledWith(
      "@nktnet/sync-request-curl-linux-x64-gnu",
    );
    expect(requireNative).toHaveBeenCalledWith(resolved);
  });

  test("throws a useful error when no matching binary exists", () => {
    const missing = Object.assign(new Error("missing"), {
      code: "MODULE_NOT_FOUND",
    });

    expect(() =>
      loadBinding({
        platformKey: "linux-arm64-musl",
        packageRoot: join("", "package"),
        exists: () => false,
        requireNative: vi.fn(),
        resolveNative: () => {
          throw missing;
        },
      }),
    ).toThrow(
      "The optional package @nktnet/sync-request-curl-linux-arm64-musl is missing",
    );
  });
});
