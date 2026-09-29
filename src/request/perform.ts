import { type CurlError, throwForTransportError } from "#/errors";
import { decompressResponseBody } from "#/http/compression";
import {
  parseResponseHeaders,
  throwForResponseFramingTransportError,
} from "#/http/headers";
import native from "#/native/index";
import { getAgentPoolId } from "#/request/agent";
import {
  type CacheableResponse,
  canCacheResponse,
  getCachedRedirectUrl,
  getCachedResponse,
  invalidateCache,
  prepareCacheLookup,
  refreshCacheEntry,
  storeCacheResponse,
} from "#/request/cache";
import { canUseRequestCache, getRequestCacheKey } from "#/request/cache-key";
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
import type { Options, Response, UppercaseHttpVerb } from "#/types";

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
  const result = native.request({
    ...prepareTransportOptions(options),
    method,
    url: prepared.url,
    headers: prepared.headers,
    ...(prepared.body === undefined ? {} : { body: prepared.body }),
    ...(prepared.form === undefined ? {} : { form: prepared.form }),
    timeout: Math.ceil(options.timeout ?? 0),
    overallTimeout: Math.ceil(remaining()),
    socketTimeout: Math.ceil(options.socketTimeout ?? 0),
    noBody: method === "HEAD",
    ...(connectionPoolId === undefined ? {} : { connectionPoolId }),
  });

  remaining();

  // libcurl may reject malformed HTTP framing itself (for example,
  // conflicting Content-Length values) after it has already delivered the
  // response header lines to our callback. Parse those captured headers first
  // so standards-level response framing errors are surfaced consistently
  // instead of being hidden behind a generic transport error.
  const responseHeaders = parseResponseHeaders(result.headers);
  throwForResponseFramingTransportError(
    result.transportCode,
    result.transportMessage,
    result.headers,
  );
  throwForTransportError(result.transportCode, result.transportMessage);
  const responseBody = decompressResponseBody(
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
    redirectUrl: result.redirectUrl,
  };
};

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
    let retryError: CurlError | null = null;
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
        !shouldRetryRequest(retry, null, result.response, attemptNumber) ||
        retries >= maxRetries
      ) {
        return result;
      }
      retryResponse = result.response;
    } catch (error) {
      if (!isRetryableRequestError(error)) {
        throw error;
      }
      if (
        !shouldRetryRequest(retry, error, undefined, attemptNumber) ||
        retries >= maxRetries
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

export const performRequest = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
  remaining: () => number = () => 0,
): RequestResult => {
  remaining();
  prepareTransportOptions(options);
  const prepared = prepareRequest(url, options, method);
  const cacheKey = getRequestCacheKey(prepared.url, options);
  const cache = canUseRequestCache(prepared.url, prepared.headers, options)
    ? options.cache
    : undefined;
  const requestTimestamp = options.cache ? Date.now() : 0;
  const cacheLookup = prepareCacheLookup(
    method,
    cacheKey,
    prepared.headers,
    cache,
    requestTimestamp,
    options.gzip !== false,
    options,
  );

  remaining();
  if (cacheLookup.useCachedResponse && cacheLookup.entry) {
    return createRequestResult(
      method,
      url,
      getCachedResponse(cacheLookup.entry),
    );
  }

  const result = performRequestWithRetry(
    method,
    url,
    options,
    {
      ...prepared,
      headers: cacheLookup.revalidationHeaders,
    },
    remaining,
  );
  const responseTimestamp = options.cache ? Date.now() : 0;

  if (cache && method === "GET" && result.response.statusCode === 304) {
    const refreshedResponse = refreshCacheEntry(
      cacheKey,
      cacheLookup,
      result.response.headers,
      responseTimestamp,
      cache,
    );
    if (refreshedResponse) {
      return createRequestResult(method, url, refreshedResponse);
    }
  }

  if (
    cache &&
    method === "GET" &&
    cacheLookup.allowStore &&
    result.response.statusCode !== 304
  ) {
    const cacheableResponse: CacheableResponse = {
      statusCode: result.response.statusCode,
      headers: result.response.headers,
      body: result.response.body,
      responseUrl: result.response.url,
    };
    const defaultValue = canCacheResponse(cacheableResponse);
    const shouldStore = options.canCache
      ? options.canCache(result.response, defaultValue)
      : defaultValue;

    storeCacheResponse(
      cacheKey,
      cacheLookup.requestHeaders,
      requestTimestamp,
      responseTimestamp,
      {
        statusCode: result.response.statusCode,
        headers: result.response.headers,
        body: result.response.body,
        responseUrl: result.response.url,
      },
      cache,
      {
        decompress: options.gzip !== false,
        shouldStore,
      },
    );
  } else if (
    options.cache &&
    !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method) &&
    result.response.statusCode >= 200 &&
    result.response.statusCode < 400
  ) {
    invalidateCache(cacheKey, options.cache);
  }

  remaining();
  return result;
};
