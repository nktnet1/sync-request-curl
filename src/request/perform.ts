import { maxHeaderSize } from "node:http";
import {
  type CurlError,
  type RequestError,
  throwForTransportError,
} from "#/errors";
import { decompressResponseBody } from "#/http/compression";
import {
  parseResponseHeaders,
  throwForResponseFramingTransportError,
  throwForResponseHeaderTransportError,
} from "#/http/headers";
import { assertSupportedHttpUrl, splitAbsoluteUrl } from "#/http/url";
import native from "#/native/index";
import { getAgentPoolId } from "#/request/agent";
import {
  type CacheableResponse,
  type CacheLookup,
  canCacheResponse,
  getCachedRedirectUrl,
  getCachedResponse,
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
} from "#/request/cache-key";
import { type PreparedRequest, prepareRequest } from "#/request/prepare";
import {
  canRetryRequest,
  defaultMaxRetries,
  getRetryDelay,
  isRetryableRequestError,
  shouldRetryRequest,
  waitForRetry,
} from "#/request/retry";
import {
  prepareTransportOptions,
  usesCustomTransport,
} from "#/request/transport-options";
import { createResponse } from "#/response";
import type { Options, Response, UppercaseHttpVerb } from "#/types/definition";

export interface RequestResult {
  response: Response;
  redirectUrl: string | null;
}

const createRequestResult = (
  method: UppercaseHttpVerb,
  requestUrl: string,
  response: CacheableResponse,
): RequestResult => ({
  response: createResponse({
    method,
    requestUrl,
    responseUrl: response.responseUrl,
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
  }),
  redirectUrl: getCachedRedirectUrl(response),
});

// Only discard a redirect body when no cache or custom retry callback can
// observe it as a complete buffered response.
const shouldStopOnRedirectHeaders = (
  method: UppercaseHttpVerb,
  options: Options,
): boolean =>
  options.followRedirects !== false &&
  !(method === "GET" && options.cache !== undefined) &&
  typeof options.retry !== "function";

const performTransportRequest = (
  method: UppercaseHttpVerb,
  originalUrl: string,
  options: Options,
  prepared: PreparedRequest,
  remaining: () => number,
): RequestResult => {
  const connectionPoolId = usesCustomTransport(options)
    ? undefined
    : getAgentPoolId(options.agent);
  const stopOnRedirectHeaders = shouldStopOnRedirectHeaders(method, options);
  const result = native.request({
    ...prepareTransportOptions(options),
    method,
    url: prepared.url,
    headers: prepared.headers,
    ...(prepared.body === undefined ? {} : { body: prepared.body }),
    timeout: Math.ceil(options.timeout ?? 0),
    connectTimeout: Math.ceil(options.connectTimeout ?? 0),
    overallTimeout: Math.ceil(remaining()),
    socketTimeout: Math.ceil(options.socketTimeout ?? 0),
    maxResponseHeaderSize: maxHeaderSize,
    noBody: method === "HEAD",
    stopOnRedirectHeaders,
    ...(connectionPoolId === undefined ? {} : { connectionPoolId }),
  });

  remaining();

  // The native callback enforces Node's response-header size limit before the
  // complete block is buffered. Other malformed headers may be delivered by
  // libcurl, so parse captured lines before surfacing generic transport errors.
  throwForResponseHeaderTransportError(
    result.transportCode,
    result.transportMessage,
  );
  const responseHeaders = parseResponseHeaders(
    result.headers,
    result.requestHeaderOffsets,
  );
  throwForResponseFramingTransportError(
    result.transportCode,
    result.transportMessage,
    result.headers,
  );
  throwForTransportError(result.transportCode, result.transportMessage);
  const redirectUrl =
    options.followRedirects === false
      ? null
      : (result.redirectUrl ??
        getCachedRedirectUrl({
          statusCode: result.statusCode,
          headers: responseHeaders,
        }));
  const responseBody =
    stopOnRedirectHeaders && redirectUrl !== null
      ? result.body
      : decompressResponseBody(
          result.body,
          responseHeaders,
          options.gzip !== false,
        );
  const response: CacheableResponse = {
    statusCode: result.statusCode,
    headers: responseHeaders,
    body: responseBody,
    responseUrl: result.effectiveUrl ?? prepared.url,
  };

  return {
    ...createRequestResult(method, originalUrl, response),
    redirectUrl,
  };
};

const shouldRetryAttempt = (
  retry: NonNullable<Options["retry"]>,
  error: CurlError | RequestError | null,
  response: Response | undefined,
  attemptNumber: number,
  maxRetries: number,
): boolean =>
  shouldRetryRequest(retry, error, response, attemptNumber) &&
  attemptNumber - 1 < maxRetries;

const performRequestWithRetry = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
  prepared: PreparedRequest,
  remaining: () => number,
): RequestResult => {
  if (!canRetryRequest(method, options.retry)) {
    return performTransportRequest(method, url, options, prepared, remaining);
  }

  const retry = options.retry;
  const maxRetries = options.maxRetries ?? defaultMaxRetries;

  for (let retries = 0; ; retries += 1) {
    const attemptNumber = retries + 1;
    let retryError: CurlError | RequestError | null = null;
    let retryResponse: Response | undefined;

    try {
      const result = performTransportRequest(
        method,
        url,
        options,
        prepared,
        remaining,
      );
      if (
        !shouldRetryAttempt(
          retry,
          null,
          result.response,
          attemptNumber,
          maxRetries,
        )
      ) {
        return result;
      }
      retryResponse = result.response;
    } catch (error) {
      if (!isRetryableRequestError(error)) {
        throw error;
      }
      if (
        !shouldRetryAttempt(retry, error, undefined, attemptNumber, maxRetries)
      ) {
        throw error;
      }
      retryError = error;
    }

    const delay = getRetryDelay(
      options.retryDelay,
      retryError,
      retryResponse,
      attemptNumber,
    );
    const budget = remaining();
    waitForRetry(budget === 0 ? delay : Math.min(delay, budget));
    remaining();
  }
};

interface RequestCacheContext {
  key: string;
  mode: Options["cache"];
  lookup: CacheLookup;
  requestTimestamp: number;
}

const prepareRequestCache = (
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
  const lookup = prepareCacheLookup(
    method,
    key,
    prepared.headers,
    mode,
    requestTimestamp,
    options.gzip !== false,
    options,
  );

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

const updateHeadCache = (
  prepared: PreparedRequest,
  options: Options,
  context: RequestCacheContext,
  result: RequestResult,
  responseTimestamp: number,
  mode: NonNullable<Options["cache"]>,
): void => {
  if (result.response.statusCode !== 200) return;
  if (context.mode === undefined) {
    invalidateRequestCache(prepared.url, options, mode);
    return;
  }
  updateCacheFromHead(
    context.key,
    context.lookup,
    result.response.headers,
    responseTimestamp,
    context.mode,
    options.gzip !== false,
    options,
  );
};

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
    const refreshedResponse = refreshCacheEntry(
      key,
      lookup,
      result.response.headers,
      responseTimestamp,
      mode,
      canCache === undefined
        ? undefined
        : (response, defaultValue) =>
            canCache(
              createRequestResult("GET", url, response).response,
              defaultValue,
            ),
    );
    return refreshedResponse === undefined || !lookup.isRevalidation
      ? result
      : createRequestResult("GET", url, refreshedResponse);
  }

  if (!lookup.allowStore) return result;
  const defaultValue = canCacheResponse(result.response);
  const shouldStore = options.canCache
    ? options.canCache(result.response, defaultValue)
    : defaultValue;

  storeCacheResponse(
    key,
    lookup.requestHeaders,
    requestTimestamp,
    responseTimestamp,
    {
      statusCode: result.response.statusCode,
      headers: result.response.headers,
      body: result.response.body,
      responseUrl: result.response.url,
    },
    mode,
    { decompress: options.gzip !== false, shouldStore },
  );
  return result;
};

const updateRequestCache = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
  prepared: PreparedRequest,
  context: RequestCacheContext,
  result: RequestResult,
): RequestResult => {
  if (options.cache === undefined) return result;
  const responseTimestamp = Date.now();
  if (method === "GET") {
    return updateGetCache(url, options, context, result, responseTimestamp);
  }
  if (method === "HEAD") {
    updateHeadCache(
      prepared,
      options,
      context,
      result,
      responseTimestamp,
      options.cache,
    );
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

export const performRequest = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
  remaining: () => number = () => 0,
): RequestResult => {
  remaining();
  prepareTransportOptions(options);
  const prepared = prepareRequest(url, options, method);
  const context = prepareRequestCache(method, prepared, options);
  remaining();
  if (context.lookup.useCachedResponse && context.lookup.entry) {
    return createRequestResult(
      method,
      url,
      getCachedResponse(context.lookup.entry),
    );
  }
  const result = performRequestWithRetry(
    method,
    url,
    options,
    { ...prepared, headers: context.lookup.revalidationHeaders },
    remaining,
  );
  const finalResult = updateRequestCache(
    method,
    url,
    options,
    prepared,
    context,
    result,
  );
  remaining();
  return finalResult;
};
