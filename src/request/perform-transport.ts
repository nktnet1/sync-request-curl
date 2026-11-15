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
import native from "#/native/index";
import { getAgentPoolId } from "#/request/agent";
import { type CacheableResponse, getCachedRedirectUrl } from "#/request/cache";
import type { PreparedRequest } from "#/request/prepare";
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

export const createRequestResult = (
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

const waitBeforeRetry = (delay: number, remaining: () => number): void => {
  const budget = remaining();
  waitForRetry(budget === 0 ? delay : Math.min(delay, budget));
  remaining();
};

type RetryAttempt =
  | { error: CurlError | RequestError; result?: never }
  | { error: null; result: RequestResult };

const executeRetryAttempt = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
  prepared: PreparedRequest,
  remaining: () => number,
): RetryAttempt => {
  try {
    return {
      error: null,
      result: performTransportRequest(
        method,
        url,
        options,
        prepared,
        remaining,
      ),
    };
  } catch (error) {
    if (!isRetryableRequestError(error)) throw error;
    return { error };
  }
};

export const performRequestWithRetry = (
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
    const attempt = executeRetryAttempt(
      method,
      url,
      options,
      prepared,
      remaining,
    );

    const retryResponse =
      attempt.error === null ? attempt.result.response : undefined;
    if (
      !shouldRetryAttempt(
        retry,
        attempt.error,
        retryResponse,
        attemptNumber,
        maxRetries,
      )
    ) {
      if (attempt.error !== null) {
        throw attempt.error;
      }
      return attempt.result;
    }

    const delay = getRetryDelay(
      options.retryDelay,
      attempt.error,
      retryResponse,
      attemptNumber,
    );
    waitBeforeRetry(delay, remaining);
  }
};
