import { parseHttpDate } from "#/http/date";
import {
  getRequestCacheControl,
  parseAgeSeconds,
  parseCacheControl,
  parseDeltaSeconds,
  requestForcesRevalidation,
} from "#/request/cache/control";
import {
  type CacheEntry,
  getHeaderValue,
  type NormalizedRequestHeaders,
} from "#/request/cache/types";

const permanentRedirectStatusCodes = new Set([301, 308]);

export const getResponseDate = (entry: CacheEntry): number => {
  const dateHeader = getHeaderValue(entry.headers, "date");
  return (
    parseHttpDate(dateHeader, entry.responseTimestamp) ??
    entry.responseTimestamp
  );
};

const getFreshnessLifetime = (entry: CacheEntry): number => {
  const cacheControl = parseCacheControl(
    getHeaderValue(entry.headers, "cache-control"),
  );
  if (cacheControl.has("max-age")) {
    // Explicit invalid freshness cannot fall back to Expires or heuristics.
    return (parseDeltaSeconds(cacheControl.get("max-age")) ?? 0) * 1_000;
  }

  const expires = getHeaderValue(entry.headers, "expires");
  if (expires === undefined) {
    // http-basic keeps bare permanent redirects reusable indefinitely. 301
    // and 308 are heuristically cacheable by HTTP, so preserve that inherited
    // behaviour when the origin did not provide an explicit freshness limit.
    if (permanentRedirectStatusCodes.has(entry.statusCode)) {
      return Number.POSITIVE_INFINITY;
    }
    return 0;
  }
  const expiresAt = parseHttpDate(expires, entry.responseTimestamp);
  if (expiresAt === undefined) {
    return 0;
  }

  return Math.max(0, expiresAt - getResponseDate(entry));
};

export const getCurrentAge = (entry: CacheEntry, now: number): number => {
  const apparentAge = Math.max(
    0,
    entry.responseTimestamp - getResponseDate(entry),
  );
  const ageHeaderSeconds = parseAgeSeconds(
    getHeaderValue(entry.headers, "age"),
  );
  const responseDelay = Math.max(
    0,
    entry.responseTimestamp - entry.requestTimestamp,
  );
  const correctedInitialAge = Math.max(
    apparentAge,
    ageHeaderSeconds * 1_000 + responseDelay,
  );
  return correctedInitialAge + Math.max(0, now - entry.responseTimestamp);
};

export const isFresh = (
  entry: CacheEntry,
  requestHeaders: NormalizedRequestHeaders,
  now: number,
): boolean => {
  const responseCacheControl = parseCacheControl(
    getHeaderValue(entry.headers, "cache-control"),
  );
  const requestCacheControl = getRequestCacheControl(requestHeaders);

  if (
    responseCacheControl.has("no-cache") ||
    requestForcesRevalidation(requestHeaders)
  ) {
    return false;
  }

  const currentAge = getCurrentAge(entry, now);
  let freshnessLifetime = getFreshnessLifetime(entry);
  const requestMaxAge = parseDeltaSeconds(requestCacheControl.get("max-age"));
  if (requestMaxAge !== undefined) {
    freshnessLifetime = Math.min(freshnessLifetime, requestMaxAge * 1_000);
  }

  const minFresh = parseDeltaSeconds(requestCacheControl.get("min-fresh"));
  return currentAge + (minFresh ?? 0) * 1_000 < freshnessLifetime;
};

export const hasValidator = (entry: CacheEntry): boolean =>
  getHeaderValue(entry.headers, "etag") !== undefined ||
  getHeaderValue(entry.headers, "last-modified") !== undefined;
