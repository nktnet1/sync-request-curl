import { afterEach, describe, expect, test, vi } from "vitest";

const originalGetuid = process.getuid;

afterEach(() => {
  Object.defineProperty(process, "getuid", {
    configurable: true,
    enumerable: true,
    value: originalGetuid,
    writable: true,
  });
  vi.resetModules();
});

describe("file cache portability", () => {
  test("falls back to a user cache directory when process.getuid is unavailable", async () => {
    Object.defineProperty(process, "getuid", {
      configurable: true,
      enumerable: true,
      value: undefined,
      writable: true,
    });
    vi.resetModules();

    const { prepareFileCacheLookup } = await import("#/request/cache");
    const lookup = prepareFileCacheLookup(
      "GET",
      `https://cache.test/no-getuid-${process.pid}-${Date.now()}`,
      [],
      "file",
      0,
    );

    expect(lookup.entry).toBeUndefined();
  });
});
