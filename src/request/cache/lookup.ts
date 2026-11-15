import { hasRequestHeader, setRequestHeader } from "#/http/headers";
import {
  getRequestCacheControl,
  requestForcesRevalidation,
} from "#/request/cache/control";
import {
  getResponseDate,
  hasValidator,
  isFresh,
} from "#/request/cache/freshness";
import { readCacheEntries } from "#/request/cache/storage";
import {
  type CacheEntry,
  type CacheLookup,
  type CacheMode,
  getHeaderValue,
  type NormalizedRequestHeaders,
  normalizeRequestHeaders,
  toCachedResponse,
} from "#/request/cache/types";
import { matchesCachePolicy } from "#/request/cache/variants";
import type { Options } from "#/types/definition";

export interface CacheLookupOptions {
  method: string;
  url: string;
  headers: string[];
  cache?: CacheMode;
  now?: number;
  decompress?: boolean;
  policy?: Pick<Options, "isMatch" | "isExpired">;
}

const conditionalRequestHeaders = [
  "range",
  "if-match",
  "if-unmodified-since",
  "if-none-match",
  "if-modified-since",
];

const bypassCachedResponse = (
  headers: string[],
  requestHeaders: NormalizedRequestHeaders,
): boolean =>
  conditionalRequestHeaders.some((name) => hasRequestHeader(headers, name)) ||
  requestForcesRevalidation(requestHeaders);

const selectCacheEntry = ({
  url,
  cache,
  decompress,
  policy,
  requestHeaders,
}: {
  url: string;
  cache: CacheMode;
  decompress: boolean;
  policy: Pick<Options, "isMatch">;
  requestHeaders: NormalizedRequestHeaders;
}): CacheEntry | undefined =>
  readCacheEntries(url, cache)
    .filter(
      (candidate) =>
        candidate.decompress === decompress &&
        matchesCachePolicy(candidate, requestHeaders, policy),
    )
    .sort(
      (left, right) =>
        getResponseDate(right) - getResponseDate(left) ||
        right.responseTimestamp - left.responseTimestamp,
    )[0];

const prepareRevalidation = (
  entry: CacheEntry,
  headers: string[],
): Pick<CacheLookup, "revalidationHeaders" | "isRevalidation"> => {
  const revalidationHeaders = [...headers];
  let isRevalidation = false;
  const etag = getHeaderValue(entry.headers, "etag");
  if (etag !== undefined) {
    setRequestHeader(revalidationHeaders, "If-None-Match", etag);
    isRevalidation = true;
  }
  const lastModified = getHeaderValue(entry.headers, "last-modified");
  if (lastModified !== undefined) {
    setRequestHeader(revalidationHeaders, "If-Modified-Since", lastModified);
    isRevalidation = true;
  }
  return { revalidationHeaders, isRevalidation };
};

export const prepareCacheLookup = ({
  method,
  url,
  headers,
  cache,
  now = Date.now(),
  decompress = true,
  policy = {},
}: CacheLookupOptions): CacheLookup => {
  const requestHeaders = normalizeRequestHeaders(headers);
  const requestCacheControl = getRequestCacheControl(requestHeaders);
  const allowStore = !requestCacheControl.has("no-store");
  const base: CacheLookup = {
    requestHeaders,
    requestTimestamp: now,
    useCachedResponse: false,
    revalidationHeaders: headers,
    isRevalidation: false,
    allowStore,
  };

  if (cache === undefined || method !== "GET" || !allowStore) {
    return base;
  }

  // Different Vary definitions can overlap. RFC 9111 selects the most recent
  // matching response by Date, which can differ from local arrival order.
  const entry = selectCacheEntry({
    url,
    cache,
    decompress,
    policy,
    requestHeaders,
  });
  if (!entry) return base;
  const matched: CacheLookup = { ...base, entry };
  if (bypassCachedResponse(headers, requestHeaders)) return matched;

  const defaultExpired = !isFresh(entry, requestHeaders, now);
  const expired = policy.isExpired
    ? policy.isExpired(toCachedResponse(entry), defaultExpired)
    : defaultExpired;
  if (!expired) {
    return { ...matched, useCachedResponse: true };
  }

  if (!hasValidator(entry)) {
    return matched;
  }

  return { ...matched, ...prepareRevalidation(entry, headers) };
};
