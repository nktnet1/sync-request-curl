import {
  canCacheResponse,
  responseForbidsStorage,
} from "#/request/cache/response-policy";
import {
  invalidateCache,
  readCacheBucketEntries,
  writeCacheEntries,
} from "#/request/cache/storage";
import {
  type CacheableResponse,
  type CacheEntry,
  type CacheMode,
  copyHeaders,
  getHeaderValue,
  type NormalizedRequestHeaders,
} from "#/request/cache/types";
import {
  getVaryNames,
  requestMatchesEntry,
  stringArraysEqual,
  varyRequestHeadersMatch,
} from "#/request/cache/variants";
import type { Response } from "#/types/definition";

interface StoreCacheResponseOptions {
  decompress?: boolean;
  shouldStore?: boolean;
  replaceEntry?: CacheEntry;
  revalidationHeaders?: Response["headers"];
}

const matchesCacheVariant = (left: CacheEntry, right: CacheEntry): boolean => {
  if (left.cacheKey !== right.cacheKey || left.decompress !== right.decompress)
    return false;
  const varyNames = getVaryNames(right);
  return (
    stringArraysEqual(getVaryNames(left), varyNames) &&
    varyRequestHeadersMatch(
      varyNames,
      left.requestHeaders,
      right.requestHeaders,
    )
  );
};

const replacesCacheEntry = (
  existing: CacheEntry,
  requestHeaders: NormalizedRequestHeaders,
  options: StoreCacheResponseOptions,
): boolean => {
  const replacement = options.replaceEntry;
  if (
    !replacement ||
    existing.cacheKey !== replacement.cacheKey ||
    existing.decompress !== replacement.decompress
  )
    return false;
  if (matchesCacheVariant(existing, replacement)) return true;
  // A strong validator identifies all matching stored copies, even when
  // their old Vary dimensions differ. Keep unrelated variants untouched.
  const tag = getHeaderValue(
    options.revalidationHeaders ?? replacement.headers,
    "etag",
  );
  return (
    tag !== undefined &&
    !tag.startsWith("W/") &&
    tag === getHeaderValue(existing.headers, "etag") &&
    requestMatchesEntry(existing, requestHeaders)
  );
};

const discardReplacedEntries = (
  url: string,
  requestHeaders: NormalizedRequestHeaders,
  cache: CacheMode,
  options: StoreCacheResponseOptions,
): void => {
  const retained = readCacheBucketEntries(url, cache).filter(
    (entry) => !replacesCacheEntry(entry, requestHeaders, options),
  );
  if (retained.length === 0) invalidateCache(url, cache);
  else writeCacheEntries(url, retained, cache);
};

export interface StoreCacheResponseRequest {
  url: string;
  requestHeaders: NormalizedRequestHeaders;
  requestTimestamp: number;
  responseTimestamp: number;
  response: CacheableResponse;
  cache: CacheMode;
  options?: StoreCacheResponseOptions;
}

export const storeCacheResponse = ({
  url,
  requestHeaders,
  requestTimestamp,
  responseTimestamp,
  response,
  cache,
  options = {},
}: StoreCacheResponseRequest): void => {
  const decompress = options.decompress ?? true;
  const shouldStore = options.shouldStore ?? canCacheResponse(response);

  if (!shouldStore) {
    if (responseForbidsStorage(response.headers)) invalidateCache(url, cache);
    else if (options.replaceEntry !== undefined)
      discardReplacedEntries(url, requestHeaders, cache, options);
    return;
  }

  const entry: CacheEntry = {
    cacheKey: url,
    decompress,
    statusCode: response.statusCode,
    headers: copyHeaders(response.headers),
    body: response.body.toString("base64"),
    responseUrl: response.responseUrl,
    requestHeaders,
    requestTimestamp,
    responseTimestamp,
  };
  const existingEntries = readCacheBucketEntries(url, cache);
  const retainedEntries = existingEntries.filter(
    (existing) =>
      !replacesCacheEntry(existing, requestHeaders, options) &&
      !matchesCacheVariant(existing, entry),
  );

  writeCacheEntries(url, [entry, ...retainedEntries], cache);
};

export const storeFileCacheResponse = (
  url: string,
  requestHeaders: NormalizedRequestHeaders,
  requestTimestamp: number,
  responseTimestamp: number,
  response: CacheableResponse,
): void =>
  storeCacheResponse({
    url,
    requestHeaders,
    requestTimestamp,
    responseTimestamp,
    response,
    cache: "file",
  });
