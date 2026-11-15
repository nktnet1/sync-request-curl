import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { getCacheBucketKey } from "#/request/cache-key";
import { fileCacheDirectory, getCachePath } from "#/request/cache-path";
import {
  type CacheBucket,
  type CacheEntry,
  type CacheMode,
  cacheBucketSchema,
} from "#/request/cache-types";

const isNotFoundError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readFileCacheEntries = (url: string): CacheEntry[] => {
  let serialized: string;
  try {
    // The URL is SHA-512 hashed by getCachePath, so it cannot control the path.
    serialized = readFileSync(getCachePath(url), "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    console.warn(
      `Error reading from cache: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    const result = v.safeParse(cacheBucketSchema, parsed);
    if (result.success) {
      return result.output.entries;
    }
  } catch {
    // A partial/stale file should behave like a cache miss, not break requests.
  }

  // Failed cleanup must not turn an optional cache into a request failure.
  try {
    rmSync(getCachePath(url), { force: true });
  } catch (error) {
    console.warn(`Error removing invalid cache entry: ${String(error)}`);
  }
  return [];
};

const writeFileCacheEntries = (url: string, entries: CacheEntry[]): void => {
  const bucket: CacheBucket = { version: 2, entries };
  try {
    // fileCacheDirectory is derived only from the OS temp directory and uid.
    mkdirSync(fileCacheDirectory, { recursive: true, mode: 0o700 });
    // The URL is SHA-512 hashed by getCachePath, so it cannot control the path.
    writeFileSync(getCachePath(url), JSON.stringify(bucket), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    console.warn(
      `Error writing to cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const memoryCacheEntries = new Map<string, CacheEntry[]>();

export const readCacheBucketEntries = (
  url: string,
  cache: CacheMode,
): CacheEntry[] =>
  cache === "memory"
    ? (memoryCacheEntries.get(getCacheBucketKey(url)) ?? [])
    : readFileCacheEntries(getCacheBucketKey(url));

export const readCacheEntries = (url: string, cache: CacheMode): CacheEntry[] =>
  readCacheBucketEntries(url, cache).filter((entry) => entry.cacheKey === url);

export const writeCacheEntries = (
  url: string,
  entries: CacheEntry[],
  cache: CacheMode,
): void => {
  if (cache === "memory") {
    memoryCacheEntries.set(getCacheBucketKey(url), entries);
    return;
  }
  writeFileCacheEntries(getCacheBucketKey(url), entries);
};

export const invalidateCache = (url: string, cache: CacheMode): void => {
  if (cache === "memory") {
    memoryCacheEntries.delete(getCacheBucketKey(url));
    return;
  }

  try {
    rmSync(getCachePath(getCacheBucketKey(url)), { force: true });
  } catch (error) {
    throw new Error(
      `Error invalidating cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const invalidateFileCache = (url: string): void =>
  invalidateCache(url, "file");
