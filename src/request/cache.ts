import { getCurrentAge } from "#/request/cache/freshness";
import {
  type CacheableResponse,
  type CacheLookup,
  copyHeaders,
  getHeaderValue,
} from "#/request/cache/types";

export { updateCacheFromHead } from "#/request/cache/head";
export { prepareCacheLookup } from "#/request/cache/lookup";
export { canCacheResponse } from "#/request/cache/response-policy";
export {
  refreshCacheEntry,
  refreshFileCacheEntry,
} from "#/request/cache/revalidation";
export { invalidateCache, invalidateFileCache } from "#/request/cache/storage";
export type { CacheableResponse, CacheLookup } from "#/request/cache/types";
export {
  storeCacheResponse,
  storeFileCacheResponse,
} from "#/request/cache/write";

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

export const getCachedResponse = (
  entry: NonNullable<CacheLookup["entry"]>,
  now = Date.now(),
): CacheableResponse => ({
  statusCode: entry.statusCode,
  headers: {
    ...copyHeaders(entry.headers),
    age: String(Math.floor(getCurrentAge(entry, now) / 1_000)),
  },
  body: Buffer.from(entry.body, "base64"),
  responseUrl: entry.responseUrl,
});

export const getCachedRedirectUrl = (
  response: Pick<CacheableResponse, "statusCode" | "headers">,
): string | null => {
  if (!redirectStatusCodes.has(response.statusCode)) {
    return null;
  }
  return getHeaderValue(response.headers, "location") ?? null;
};
