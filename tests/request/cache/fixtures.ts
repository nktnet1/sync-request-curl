import {
  prepareCacheLookup,
  storeCacheResponse,
  updateCacheFromHead,
} from "#/request/cache";

type CacheLookupOptions = Parameters<typeof prepareCacheLookup>[0];
type StoreCacheResponseRequest = Parameters<typeof storeCacheResponse>[0];

/** Build a cache lookup with ordinary GET defaults; tests supply only differences. */
export const lookupCache = (
  url: string,
  cache: CacheLookupOptions["cache"],
  options: Partial<Omit<CacheLookupOptions, "url" | "cache">> = {},
): ReturnType<typeof prepareCacheLookup> =>
  prepareCacheLookup({ method: "GET", url, headers: [], cache, ...options });

type HeadOptions = Parameters<typeof updateCacheFromHead>[0];

/** Store a standard cached response, overriding only the relevant test inputs. */
export const storeCacheFixture = (
  url: string,
  cache: StoreCacheResponseRequest["cache"],
  response: StoreCacheResponseRequest["response"],
  options: Partial<
    Omit<StoreCacheResponseRequest, "url" | "cache" | "response">
  > = {},
): void =>
  storeCacheResponse({
    url,
    requestHeaders: {},
    requestTimestamp: 0,
    responseTimestamp: 0,
    response,
    cache,
    ...options,
  });

/** Apply HEAD metadata against a prepared cache lookup with common defaults. */
export const updateHeadFixture = (
  url: string,
  cache: HeadOptions["cache"],
  lookup: HeadOptions["lookup"],
  responseHeaders: HeadOptions["responseHeaders"],
  responseTimestamp: number,
  options: Partial<
    Omit<
      HeadOptions,
      "url" | "cache" | "lookup" | "responseHeaders" | "responseTimestamp"
    >
  > = {},
): void =>
  updateCacheFromHead({
    url,
    cache,
    lookup,
    responseHeaders,
    responseTimestamp,
    decompress: true,
    ...options,
  });
