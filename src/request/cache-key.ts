import { hasRequestHeader } from "#/http/headers";
import { splitAbsoluteUrl } from "#/http/url";
import { usesCustomTransport } from "#/request/transport-options";
import type { Options } from "#/types/definition";

// Normalize literal dot segments as libcurl does, without decoding %2e or
// changing other path bytes. WHATWG URL.pathname also collapses encoded dots.
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

/** Private application namespace plus the actual HTTP target (no fragment). */
export const getRequestCacheKey = (url: string, options: Options): string => {
  const target = new URL(url);
  const parts = splitAbsoluteUrl(url);
  const cacheTarget = parts
    ? `${target.origin}${normalizeCacheTarget(parts.remainder.split("#", 1)[0])}`
    : url.split("#", 1)[0];
  // Old file caches may contain responses stored under colliding URL keys.
  return JSON.stringify([
    options.cacheNamespace ?? process.cwd(),
    2,
    cacheTarget,
  ]);
};

/** Do not persist personalized data or mix trust/routing policies in a cache. */
export const canUseRequestCache = (
  url: string,
  headers: string[],
  options: Options,
): boolean => {
  const target = new URL(url);
  return (
    !target.username &&
    !target.password &&
    !hasRequestHeader(headers, "host") &&
    !hasRequestHeader(headers, "authorization") &&
    !hasRequestHeader(headers, "cookie") &&
    !hasRequestHeader(headers, "proxy-authorization") &&
    options.body === undefined &&
    options.json === undefined &&
    options.form === undefined &&
    options.auth === undefined &&
    !usesCustomTransport(options)
  );
};
