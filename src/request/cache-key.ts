import { hasRequestHeader } from "#/http/headers";
import { usesCustomTransport } from "#/request/transport-options";
import type { Options } from "#/types/definition";

/** Private application namespace plus canonical HTTP target (no fragment). */
export const getRequestCacheKey = (url: string, options: Options): string => {
  const target = new URL(url);
  target.hash = "";
  target.username = "";
  target.password = "";
  return JSON.stringify([options.cacheNamespace ?? process.cwd(), target.href]);
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
    !usesCustomTransport(options)
  );
};
