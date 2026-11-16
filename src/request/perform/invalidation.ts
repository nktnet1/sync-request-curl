import { assertSupportedHttpUrl, splitAbsoluteUrl } from "#/http/url";
import { invalidateCache } from "#/request/cache";
import { getRequestCacheInvalidationKeys } from "#/request/cache/key";
import type { Options, Response } from "#/types/definition";

export const invalidateRequestCache = (
  url: string,
  options: Options,
  mode: NonNullable<Options["cache"]>,
): void => {
  for (const key of getRequestCacheInvalidationKeys(url, options)) {
    invalidateCache(key, mode);
  }
};

const getRelatedInvalidationUrl = (
  requestUrl: string,
  response: Response,
  name: string,
): string | undefined => {
  const value = response.headers[name];
  if (typeof value !== "string") return undefined;
  try {
    const resolved = new URL(value, response.url);
    if (resolved.origin !== new URL(requestUrl).origin) return undefined;
    // Keep absolute encoded-dot spellings so both native interpretations are
    // invalidated. Relative references use the same base as redirect handling.
    const target = splitAbsoluteUrl(value) ? value : resolved.href;
    assertSupportedHttpUrl(target);
    return target;
  } catch {
    // Invalid metadata must not turn a completed write into a request failure.
    return undefined;
  }
};

export const invalidateMutationCache = (
  url: string,
  response: Response,
  options: Options,
  mode: NonNullable<Options["cache"]>,
): void => {
  invalidateRequestCache(url, options, mode);
  for (const name of ["location", "content-location"]) {
    const related = getRelatedInvalidationUrl(url, response, name);
    if (related !== undefined) invalidateRequestCache(related, options, mode);
  }
};
