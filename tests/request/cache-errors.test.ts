import { beforeEach, describe, expect, test, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => fsMock);

import {
  invalidateFileCache,
  prepareFileCacheLookup,
  storeFileCacheResponse,
} from "#/request/cache";

const fsError = (message: string, code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

const nonError = (message: string): { toString: () => string } => ({
  toString: () => message,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("file cache filesystem failures", () => {
  test("reports non-ENOENT cache read failures", () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw fsError("permission denied", "EACCES");
    });

    expect(() =>
      prepareFileCacheLookup(
        "GET",
        "https://cache.test/read-error",
        [],
        "file",
        0,
      ),
    ).toThrowError("Error reading from cache: permission denied");
  });

  test("warns and continues when a cache write fails", () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw fsError("missing", "ENOENT");
    });
    fsMock.writeFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    storeFileCacheResponse("https://cache.test/write-error", {}, 0, 0, {
      statusCode: 200,
      headers: { "cache-control": "max-age=60" },
      body: Buffer.from("cached"),
      responseUrl: "https://cache.test/write-error",
    });

    expect(warn).toHaveBeenCalledWith("Error writing to cache: disk full");
    warn.mockRestore();
  });

  test("wraps cache invalidation failures", () => {
    fsMock.rmSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(() =>
      invalidateFileCache("https://cache.test/invalidate-error"),
    ).toThrowError("Error invalidating cache: permission denied");
  });
});

describe("file cache non-Error failures", () => {
  test("stringifies non-Error cache read failures", () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw nonError("read failed");
    });

    expect(() =>
      prepareFileCacheLookup(
        "GET",
        "https://cache.test/read-non-error",
        [],
        "file",
        0,
      ),
    ).toThrowError("Error reading from cache: read failed");
  });

  test("stringifies non-Error cache write failures", () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw fsError("missing", "ENOENT");
    });
    fsMock.writeFileSync.mockImplementation(() => {
      throw nonError("write failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    storeFileCacheResponse("https://cache.test/write-non-error", {}, 0, 0, {
      statusCode: 200,
      headers: { "cache-control": "max-age=60" },
      body: Buffer.from("cached"),
      responseUrl: "https://cache.test/write-non-error",
    });

    expect(warn).toHaveBeenCalledWith("Error writing to cache: write failed");
    warn.mockRestore();
  });

  test("stringifies non-Error cache invalidation failures", () => {
    fsMock.rmSync.mockImplementation(() => {
      throw nonError("invalidate failed");
    });

    expect(() =>
      invalidateFileCache("https://cache.test/invalidate-non-error"),
    ).toThrowError("Error invalidating cache: invalidate failed");
  });
});
