import { canCacheResponse } from "#/request/cache/response-policy";
import {
  invalidateCache,
  readCacheBucketEntries,
  writeCacheEntries,
} from "#/request/cache/storage";
import {
  type CacheEntry,
  type CacheLookup,
  type CacheMode,
  copyHeaders,
  getHeaderValue,
} from "#/request/cache/types";
import { matchesCachePolicy } from "#/request/cache/variants";
import type { Options, Response } from "#/types/definition";

export const mergeRevalidationHeaders = (
  cached: Response["headers"],
  revalidated: Response["headers"],
): Response["headers"] => {
  const merged = copyHeaders(cached);
  // Age belongs to this validation response. An absent field starts at zero;
  // retaining the earlier response's Age can force endless revalidation.
  delete merged.age;
  for (const [name, value] of Object.entries(revalidated)) {
    // RFC 9111 section 3.2 excludes Content-Length from stored-header updates.
    if (name === "content-length") {
      continue;
    }

    // Neither 304 nor HEAD supplies replacement bytes. Keep the coding of the
    // retained body, whether it was decoded, deliberately left encoded, or used
    // an unsupported coding. RFC 9111 section 3.2 permits this integrity guard.
    if (name === "content-encoding") {
      continue;
    }

    merged[name] = Array.isArray(value) ? [...value] : value;
  }

  return merged;
};

/** A HEAD response can refresh GET metadata, but never replace its body. */
export interface HeadCacheRequest {
  url: string;
  lookup: CacheLookup;
  responseHeaders: Response["headers"];
  responseTimestamp: number;
  cache: CacheMode;
  decompress: boolean;
  policy?: Pick<Options, "isMatch">;
}

const headValidatorsMatch = (
  entry: CacheEntry,
  responseHeaders: Response["headers"],
): boolean =>
  ["etag", "last-modified", "content-length"].every((name) => {
    const received = getHeaderValue(responseHeaders, name);
    return (
      received === undefined || received === getHeaderValue(entry.headers, name)
    );
  });

const updateHeadEntry = (
  entry: CacheEntry,
  request: HeadCacheRequest,
): CacheEntry | undefined => {
  const {
    url,
    lookup,
    responseHeaders,
    responseTimestamp,
    decompress,
    policy = {},
  } = request;
  // A different spelling might be the same native target. Its metadata is
  // unsafe to update on builds that preserve encoded dots; discard it.
  if (entry.cacheKey !== url) return undefined;
  if (
    entry.decompress !== decompress ||
    !matchesCachePolicy(entry, lookup.requestHeaders, policy)
  )
    return entry;
  if (
    !lookup.allowStore ||
    entry.statusCode !== 200 ||
    !headValidatorsMatch(entry, responseHeaders)
  )
    return undefined;
  const headers = mergeRevalidationHeaders(entry.headers, responseHeaders);
  if (!canCacheResponse({ statusCode: entry.statusCode, headers }))
    return undefined;
  return {
    ...entry,
    headers,
    requestHeaders: lookup.requestHeaders,
    requestTimestamp: lookup.requestTimestamp,
    responseTimestamp,
  };
};

export const updateCacheFromHead = ({
  url,
  lookup,
  responseHeaders,
  responseTimestamp,
  cache,
  decompress,
  policy = {},
}: HeadCacheRequest): void => {
  const entries = readCacheBucketEntries(url, cache);
  const updated = entries.flatMap((entry) => {
    const revised = updateHeadEntry(entry, {
      url,
      lookup,
      responseHeaders,
      responseTimestamp,
      cache,
      decompress,
      policy,
    });
    return revised === undefined ? [] : [revised];
  });
  if (updated.length === 0) {
    if (entries.length > 0) invalidateCache(url, cache);
  } else {
    writeCacheEntries(url, updated, cache);
  }
};
