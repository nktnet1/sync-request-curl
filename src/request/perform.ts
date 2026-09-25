import { type CurlError, throwForTransportError } from "#/errors";
import { decompressResponseBody } from "#/http/compression";
import { parseResponseHeaders } from "#/http/headers";
import native from "#/native/index";
import { getAgentPoolId } from "#/request/agent";
import {
  type CacheableResponse,
  getCachedRedirectUrl,
  getCachedResponse,
  invalidateCache,
  prepareCacheLookup,
  refreshCacheEntry,
  storeCacheResponse,
} from "#/request/cache";
import { type PreparedRequest, prepareRequest } from "#/request/prepare";
import {
  canRetryRequest,
  defaultMaxRetries,
  getRetryDelay,
  isRetryableRequestError,
  shouldRetryRequest,
  waitForRetry,
} from "#/request/retry";
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
): RequestResult => {
  const connectionPoolId = getAgentPoolId(options.agent);
  const result = native.request({
    method,
    url: prepared.url,
    headers: prepared.headers,
    ...(prepared.body === undefined ? {} : { body: prepared.body }),
    ...(prepared.form === undefined ? {} : { form: prepared.form }),
    timeout: options.timeout ?? 0,
    socketTimeout: options.socketTimeout ?? 0,
    noBody: method === "HEAD",
    ...(connectionPoolId === undefined ? {} : { connectionPoolId }),
  });

  throwForTransportError(result.transportCode, result.transportMessage);

  const responseHeaders = parseResponseHeaders(result.headers);
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
): RequestResult => {
  if (!canRetryRequest(method, options.retry)) {
    return performTransportRequest(method, url, options, prepared);
  }

  const retry = options.retry;
  const maxRetries = options.maxRetries ?? defaultMaxRetries;

  for (let retries = 0; ; retries += 1) {
    const attemptNumber = retries + 1;
    let retryError: CurlError | null = null;
    let retryResponse: Response | undefined;

    try {
      const result = performTransportRequest(method, url, options, prepared);
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

    waitForRetry(
      getRetryDelay(
        options.retryDelay,
        retryError,
        retryResponse,
        attemptNumber,
      ),
    );
  }
};

export const performRequest = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
): RequestResult => {
  const prepared = prepareRequest(url, options);
  const requestTimestamp = options.cache ? Date.now() : 0;
  const cacheLookup = prepareCacheLookup(
    method,
    prepared.url,
    prepared.headers,
    options.cache,
    requestTimestamp,
  );

  if (cacheLookup.useCachedResponse && cacheLookup.entry) {
    return createRequestResult(
      method,
      url,
      getCachedResponse(cacheLookup.entry),
    );
  }

  const result = performRequestWithRetry(method, url, options, {
    ...prepared,
    headers: cacheLookup.revalidationHeaders,
  });
  const responseTimestamp = options.cache ? Date.now() : 0;

  if (options.cache && method === "GET" && result.response.statusCode === 304) {
    const refreshedResponse = refreshCacheEntry(
      prepared.url,
      cacheLookup,
      result.response.headers,
      responseTimestamp,
      options.cache,
    );
    if (refreshedResponse) {
      return createRequestResult(method, url, refreshedResponse);
    }
  }

  if (
    options.cache &&
    method === "GET" &&
    cacheLookup.allowStore &&
    result.response.statusCode !== 304
  ) {
    storeCacheResponse(
      prepared.url,
      cacheLookup.requestHeaders,
      requestTimestamp,
      responseTimestamp,
      {
        statusCode: result.response.statusCode,
        headers: result.response.headers,
        body: result.response.body,
        responseUrl: result.response.url,
      },
      options.cache,
    );
  } else if (
    options.cache &&
    !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method) &&
    result.response.statusCode >= 200 &&
    result.response.statusCode < 400
  ) {
    invalidateCache(prepared.url, options.cache);
  }

  return result;
};
