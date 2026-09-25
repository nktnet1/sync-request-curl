import { throwForTransportError } from "#/errors";
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
import { prepareRequest } from "#/request/prepare";
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

export const performRequest = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
): RequestResult => {
  const { url: requestUrl, headers, body, form } = prepareRequest(url, options);
  const requestTimestamp = options.cache ? Date.now() : 0;
  const cacheLookup = prepareCacheLookup(
    method,
    requestUrl,
    headers,
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

  const connectionPoolId = getAgentPoolId(options.agent);
  const result = native.request({
    method,
    url: requestUrl,
    headers: cacheLookup.revalidationHeaders,
    ...(body === undefined ? {} : { body }),
    ...(form === undefined ? {} : { form }),
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
  const responseTimestamp = options.cache ? Date.now() : 0;

  if (options.cache && method === "GET" && result.statusCode === 304) {
    const refreshedResponse = refreshCacheEntry(
      requestUrl,
      cacheLookup,
      responseHeaders,
      responseTimestamp,
      options.cache,
    );
    if (refreshedResponse) {
      return createRequestResult(method, url, refreshedResponse);
    }
  }

  const cacheableResponse: CacheableResponse = {
    statusCode: result.statusCode,
    headers: responseHeaders,
    body: responseBody,
    responseUrl: result.effectiveUrl ?? requestUrl,
  };

  if (
    options.cache &&
    method === "GET" &&
    cacheLookup.allowStore &&
    result.statusCode !== 304
  ) {
    storeCacheResponse(
      requestUrl,
      cacheLookup.requestHeaders,
      requestTimestamp,
      responseTimestamp,
      cacheableResponse,
      options.cache,
    );
  } else if (
    options.cache &&
    !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method) &&
    result.statusCode >= 200 &&
    result.statusCode < 400
  ) {
    invalidateCache(requestUrl, options.cache);
  }

  return {
    ...createRequestResult(method, url, cacheableResponse),
    redirectUrl: result.redirectUrl,
  };
};
