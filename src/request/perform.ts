import { throwForTransportError } from "#/errors";
import { decompressResponseBody } from "#/http/compression";
import { parseResponseHeaders } from "#/http/headers";
import native from "#/native/index";
import { getAgentPoolId } from "#/request/agent";
import {
  type CacheableResponse,
  getCachedRedirectUrl,
  getCachedResponse,
  invalidateFileCache,
  prepareFileCacheLookup,
  refreshFileCacheEntry,
  storeFileCacheResponse,
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
  const requestTimestamp = options.cache === "file" ? Date.now() : 0;
  const cacheLookup = prepareFileCacheLookup(
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

  throwForTransportError(result.transportCode, result.transportMessage, {
    method,
    url,
    options,
  });

  const responseHeaders = parseResponseHeaders(result.headers);
  const responseBody = decompressResponseBody(
    result.body,
    responseHeaders,
    options.gzip !== false,
  );
  const responseTimestamp = options.cache === "file" ? Date.now() : 0;

  if (
    options.cache === "file" &&
    method === "GET" &&
    result.statusCode === 304
  ) {
    const refreshedResponse = refreshFileCacheEntry(
      requestUrl,
      cacheLookup,
      responseHeaders,
      responseTimestamp,
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
    options.cache === "file" &&
    method === "GET" &&
    cacheLookup.allowStore &&
    result.statusCode !== 304
  ) {
    storeFileCacheResponse(
      requestUrl,
      cacheLookup.requestHeaders,
      requestTimestamp,
      responseTimestamp,
      cacheableResponse,
    );
  } else if (
    options.cache === "file" &&
    !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method) &&
    result.statusCode >= 200 &&
    result.statusCode < 400
  ) {
    invalidateFileCache(requestUrl);
  }

  return {
    ...createRequestResult(method, url, cacheableResponse),
    redirectUrl: result.redirectUrl,
  };
};
