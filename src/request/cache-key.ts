import { hasRequestHeader } from "#/http/headers";
import { hasUrlCredentials, splitAbsoluteUrl } from "#/http/url";
import { usesCustomTransport } from "#/request/transport-options";
import type { Options } from "#/types/definition";

// libcurl builds differ in how they normalize encoded dots. Keep read targets
// separate, but invalidate their shared WHATWG-normalized bucket together.
const encodedDotSegments = new Set(["%2e", "%2e.", ".%2e", "%2e%2e"]);
// Retire entries that may mix URL-authenticated and anonymous responses.
const cacheKeyVersion = 8;

const normalizeCacheTarget = (target: string): string => {
  const queryStart = target.indexOf("?");
  const path = queryStart < 0 ? target : target.slice(0, queryStart);
  const query = queryStart < 0 ? "" : target.slice(queryStart);
  const segments: string[] = [];
  for (const segment of path.split("/").slice(1)) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== ".") {
      segments.push(segment);
    }
  }
  if (path.endsWith("/.") || path.endsWith("/..")) {
    segments.push("");
  }
  return `/${segments.join("/")}${query}`;
};

const getCacheTarget = (url: string): string => {
  const target = new URL(url);
  const parts = splitAbsoluteUrl(url);
  if (!parts) return url.split("#", 1)[0];
  const remainder = parts.remainder.split("#", 1)[0];
  const path = remainder.split("?", 1)[0];
  const hasEncodedDots = path
    .split("/")
    .some((segment) => encodedDotSegments.has(segment.toLowerCase()));
  return `${target.origin}${hasEncodedDots ? remainder : normalizeCacheTarget(remainder)}`;
};

const createCacheKey = (target: string, options: Options): string => {
  const parts = splitAbsoluteUrl(target);
  const parsed = new URL(target);
  const bucketTarget = parts
    ? `${parsed.origin}${parsed.pathname}${parsed.search}`
    : target;
  return JSON.stringify([
    options.cacheNamespace ?? process.cwd(),
    cacheKeyVersion,
    bucketTarget,
    target,
  ]);
};

/** Namespace, invalidation bucket, and exact read target (without a fragment). */
export const getRequestCacheKey = (url: string, options: Options): string =>
  createCacheKey(getCacheTarget(url), options);

export const getCacheBucketKey = (key: string): string => {
  try {
    const identity: unknown = JSON.parse(key);
    if (
      Array.isArray(identity) &&
      identity.length === 4 &&
      identity[1] === cacheKeyVersion &&
      [identity[0], identity[2], identity[3]].every(
        (value) => typeof value === "string",
      )
    ) {
      return JSON.stringify(identity.slice(0, 3));
    }
  } catch {
    // Low-level cache helpers also accept ordinary, non-JSON keys.
  }
  return key;
};

export const getRequestCacheInvalidationKeys = (
  url: string,
  options: Options,
): string[] => {
  const target = getCacheTarget(url);
  const parts = splitAbsoluteUrl(target);
  const literalTarget = parts
    ? `${new URL(target).origin}${normalizeCacheTarget(parts.remainder)}`
    : target;
  const keys = [
    createCacheKey(target, options),
    createCacheKey(literalTarget, options),
  ];
  return [
    ...new Map(keys.map((key) => [getCacheBucketKey(key), key])).values(),
  ];
};

/** Do not persist personalized data or mix trust/routing policies in a cache. */
export const canUseRequestCache = (
  url: string,
  headers: string[],
  options: Options,
): boolean => {
  return (
    splitAbsoluteUrl(url) !== undefined &&
    !hasUrlCredentials(url) &&
    !hasRequestHeader(headers, "host") &&
    !hasRequestHeader(headers, "authorization") &&
    !hasRequestHeader(headers, "cookie") &&
    !hasRequestHeader(headers, "proxy-authorization") &&
    options.body === undefined &&
    options.json === undefined &&
    options.form === undefined &&
    options.auth === undefined &&
    // Mixed encoded dots and literal parents can reach different targets on
    // different builds. Bypass reads/stores and invalidate both possibilities.
    getRequestCacheInvalidationKeys(url, options).length === 1 &&
    !usesCustomTransport(options)
  );
};
