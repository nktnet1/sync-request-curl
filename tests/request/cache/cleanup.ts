import { afterEach } from "vitest";
import { invalidateCache } from "#/request/cache";
import type { Options } from "#/types/definition";

type CacheMode = NonNullable<Options["cache"]>;

/** Track this test file's cache entries and remove them after each test. */
export const createCacheTracker = () => {
  const touched = new Map<string, CacheMode>();
  afterEach(() => {
    for (const [key, cache] of touched) invalidateCache(key, cache);
    touched.clear();
  });
  return (key: string, cache: CacheMode): void => {
    touched.set(key, cache);
  };
};
