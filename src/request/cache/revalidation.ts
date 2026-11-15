import { RequestError } from "#/errors";
import { mergeRevalidationHeaders } from "#/request/cache/head";
import { canCacheResponse } from "#/request/cache/response-policy";
import { invalidateCache } from "#/request/cache/storage";
import {
  type CacheableResponse,
  type CacheEntry,
  type CacheLookup,
  type CacheMode,
  getHeaderValue,
} from "#/request/cache/types";
import { getRequestHeaderValue } from "#/request/cache/variants";
import { storeCacheResponse } from "#/request/cache/write";
import type { Response } from "#/types/definition";

const revalidationValidatorsMatch = (
  entry: CacheEntry,
  responseHeaders: Response["headers"],
): boolean => {
  const receivedTag = getHeaderValue(responseHeaders, "etag");
  const storedTag = getHeaderValue(entry.headers, "etag");
  if (receivedTag !== undefined) {
    return receivedTag.startsWith("W/")
      ? receivedTag.slice(2) === storedTag?.replace(/^W\//, "")
      : receivedTag === storedTag;
  }
  const receivedDate = getHeaderValue(responseHeaders, "last-modified");
  const storedDate = getHeaderValue(entry.headers, "last-modified");
  return receivedDate === undefined || receivedDate === storedDate;
};

const isExplicitCacheRevalidation = (
  entry: CacheEntry,
  lookup: CacheLookup,
  responseHeaders: Response["headers"],
): boolean => {
  const hasCondition =
    getRequestHeaderValue(lookup.requestHeaders, "if-none-match") !==
      undefined ||
    getRequestHeaderValue(lookup.requestHeaders, "if-modified-since") !==
      undefined;
  const hasResponseValidator =
    getHeaderValue(responseHeaders, "etag") !== undefined ||
    getHeaderValue(responseHeaders, "last-modified") !== undefined;
  return (
    hasCondition &&
    hasResponseValidator &&
    revalidationValidatorsMatch(entry, responseHeaders)
  );
};

export interface RefreshCacheEntryRequest {
  url: string;
  lookup: CacheLookup;
  responseHeaders: Response["headers"];
  responseTimestamp: number;
  cache: CacheMode;
  canCache?: (response: CacheableResponse, defaultValue: boolean) => boolean;
}

export const refreshCacheEntry = ({
  url,
  lookup,
  responseHeaders,
  responseTimestamp,
  cache,
  canCache,
}: RefreshCacheEntryRequest): CacheableResponse | undefined => {
  const entry = lookup.entry;
  if (!entry || !lookup.allowStore) return undefined;
  if (
    !lookup.isRevalidation &&
    !isExplicitCacheRevalidation(entry, lookup, responseHeaders)
  )
    return undefined;
  if (!revalidationValidatorsMatch(entry, responseHeaders)) {
    invalidateCache(url, cache);
    throw new RequestError(
      "ERR_REQUEST_FAILED",
      "Request failed: 304 validator does not match cached response",
    );
  }

  const response: CacheableResponse = {
    statusCode: entry.statusCode,
    headers: mergeRevalidationHeaders(entry.headers, responseHeaders),
    body: Buffer.from(entry.body, "base64"),
    responseUrl: entry.responseUrl,
  };
  const defaultValue = canCacheResponse(response);
  const shouldStore = canCache
    ? canCache(response, defaultValue)
    : defaultValue;
  if (!shouldStore) {
    invalidateCache(url, cache);
    return response;
  }
  storeCacheResponse({
    url,
    requestHeaders: lookup.requestHeaders,
    requestTimestamp: lookup.requestTimestamp,
    responseTimestamp,
    response,
    cache,
    options: {
      decompress: entry.decompress,
      shouldStore,
      replaceEntry: entry,
      revalidationHeaders: responseHeaders,
    },
  });
  return response;
};

export const refreshFileCacheEntry = (
  url: string,
  lookup: CacheLookup,
  responseHeaders: Response["headers"],
  responseTimestamp: number,
): CacheableResponse | undefined =>
  refreshCacheEntry({
    url,
    lookup,
    responseHeaders,
    responseTimestamp,
    cache: "file",
  });
