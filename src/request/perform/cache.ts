import { assertSupportedHttpUrl, splitAbsoluteUrl } from "#/http/url";
import {
  type CacheLookup,
  canCacheResponse,
  invalidateCache,
  prepareCacheLookup,
  refreshCacheEntry,
  storeCacheResponse,
  updateCacheFromHead,
} from "#/request/cache";
import {
  canUseRequestCache,
  getRequestCacheInvalidationKeys,
  getRequestCacheKey,
} from "#/request/cache/key";
import {
  createRequestResult,
  type RequestResult,
} from "#/request/perform/transport";
import type { PreparedRequest } from "#/request/prepare";
import type { Options, Response, UppercaseHttpVerb } from "#/types/definition";

interface RequestCacheContext {
  key: string;
  mode: Options["cache"];
  lookup: CacheLookup;
  requestTimestamp: number;
}

export const prepareRequestCache = (
  method: UppercaseHttpVerb,
  prepared: PreparedRequest,
  options: Options,
): RequestCacheContext => {
  const key = options.cache ? getRequestCacheKey(prepared.url, options) : "";
  const mode =
    options.cache && canUseRequestCache(prepared.url, prepared.headers, options)
      ? options.cache
      : undefined;
  const requestTimestamp = options.cache ? Date.now() : 0;
  const lookup = prepareCacheLookup({
    method,
    url: key,
    headers: prepared.headers,
    cache: mode,
    now: requestTimestamp,
    decompress: options.gzip !== false,
    policy: options,
  });

  return { key, mode, lookup, requestTimestamp };
};

const invalidateRequestCache = (
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

const invalidateMutationCache = (
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

interface HeadCacheUpdate {
  prepared: PreparedRequest;
  options: Options;
  context: RequestCacheContext;
  result: RequestResult;
  responseTimestamp: number;
  mode: NonNullable<Options["cache"]>;
}

const updateHeadCache = ({
  prepared,
  options,
  context,
  result,
  responseTimestamp,
  mode,
}: HeadCacheUpdate): void => {
  if (result.response.statusCode !== 200) return;
  if (context.mode === undefined) {
    invalidateRequestCache(prepared.url, options, mode);
    return;
  }
  updateCacheFromHead({
    url: context.key,
    lookup: context.lookup,
    responseHeaders: result.response.headers,
    responseTimestamp,
    cache: context.mode,
    decompress: options.gzip !== false,
    policy: options,
  });
};

// Complete successful responses supersede the matched representation even
// when storage is rejected or Vary changes. Exclude partial (206) and
// potentially delta-encoded (226) responses, which need separate handling.
const completeSuccessfulStatusCodes = new Set([
  200, 201, 202, 203, 204, 205, 207, 208,
]);

const updateGetCache = (
  url: string,
  options: Options,
  context: RequestCacheContext,
  result: RequestResult,
  responseTimestamp: number,
): RequestResult => {
  const { key, mode, lookup, requestTimestamp } = context;
  if (mode === undefined) return result;

  if (result.response.statusCode === 304) {
    const canCache = options.canCache;
    const refreshedResponse = refreshCacheEntry({
      url: key,
      lookup,
      responseHeaders: result.response.headers,
      responseTimestamp,
      cache: mode,
      canCache:
        canCache === undefined
          ? undefined
          : (response, defaultValue) =>
              canCache(
                createRequestResult("GET", url, response).response,
                defaultValue,
              ),
    });
    return refreshedResponse === undefined || !lookup.isRevalidation
      ? result
      : createRequestResult("GET", url, refreshedResponse);
  }

  if (!lookup.allowStore) return result;
  const defaultValue = canCacheResponse(result.response);
  const shouldStore = options.canCache
    ? options.canCache(result.response, defaultValue)
    : defaultValue;

  storeCacheResponse({
    url: key,
    requestHeaders: lookup.requestHeaders,
    requestTimestamp,
    responseTimestamp,
    response: {
      statusCode: result.response.statusCode,
      headers: result.response.headers,
      body: result.response.body,
      responseUrl: result.response.url,
    },
    cache: mode,
    options: {
      decompress: options.gzip !== false,
      shouldStore,
      replaceEntry: completeSuccessfulStatusCodes.has(
        result.response.statusCode,
      )
        ? lookup.entry
        : undefined,
    },
  });
  return result;
};

interface CacheUpdate {
  method: UppercaseHttpVerb;
  url: string;
  options: Options;
  prepared: PreparedRequest;
  context: RequestCacheContext;
  result: RequestResult;
}

export const updateRequestCache = ({
  method,
  url,
  options,
  prepared,
  context,
  result,
}: CacheUpdate): RequestResult => {
  if (options.cache === undefined) return result;
  const responseTimestamp = Date.now();
  if (method === "GET") {
    return updateGetCache(url, options, context, result, responseTimestamp);
  }
  if (method === "HEAD") {
    updateHeadCache({
      prepared,
      options,
      context,
      result,
      responseTimestamp,
      mode: options.cache,
    });
    return result;
  }
  if (
    !["OPTIONS", "TRACE"].includes(method) &&
    result.response.statusCode >= 200 &&
    result.response.statusCode < 400
  ) {
    invalidateMutationCache(
      prepared.url,
      result.response,
      options,
      options.cache,
    );
  }
  return result;
};
