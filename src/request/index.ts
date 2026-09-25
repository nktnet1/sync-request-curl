import { URL } from "node:url";
import * as v from "valibot";
import { type CurlError, RequestError } from "#/errors";
import { performRequest } from "#/request/perform";
import {
  getRedirectMethod,
  getRedirectOptions,
  getRemainingTimeout,
} from "#/request/redirects";
import {
  canRetryRequest,
  defaultMaxRetries,
  getRetryDelay,
  isRetryableRequestError,
  shouldRetryRequest,
  waitForRetry,
} from "#/request/retry";
import type { HttpVerb, Options, Response, UppercaseHttpVerb } from "#/types";
import { httpVerbSchema, optionsSchema, requestUrlSchema } from "#/validation";

const normalizeMethod = (method: HttpVerb): UppercaseHttpVerb =>
  v.parse(httpVerbSchema, method);

const getRedirectLimit = (maxRedirects: number | undefined): number => {
  if (
    maxRedirects === undefined ||
    !Number.isFinite(maxRedirects) ||
    maxRedirects < 0
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(maxRedirects);
};

const performRequestAttempt = (
  originalMethod: UppercaseHttpVerb,
  originalUrl: string,
  originalOptions: Options,
): Response => {
  if (originalOptions.followRedirects === false) {
    return performRequest(originalMethod, originalUrl, originalOptions)
      .response;
  }

  const startedAt = Date.now();
  const redirectLimit = getRedirectLimit(originalOptions.maxRedirects);
  let currentMethod = originalMethod;
  let currentUrl = originalUrl;
  let currentOptions = originalOptions;

  for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
    if (originalOptions.timeout && originalOptions.timeout > 0) {
      currentOptions = {
        ...currentOptions,
        timeout: getRemainingTimeout(originalOptions.timeout, startedAt),
      };
    }

    const { response, redirectUrl } = performRequest(
      currentMethod,
      currentUrl,
      currentOptions,
    );
    if (!redirectUrl) {
      return response;
    }

    if (redirectsFollowed >= redirectLimit) {
      throw new RequestError(
        "ERR_TOO_MANY_REDIRECTS",
        "Request failed: Number of redirects hit maximum amount",
      );
    }

    const nextUrl = new URL(redirectUrl, response.url).href;
    const nextMethod = getRedirectMethod(currentMethod, response.statusCode);

    currentOptions = getRedirectOptions(
      currentOptions,
      nextMethod !== currentMethod,
    );
    currentMethod = nextMethod;
    currentUrl = nextUrl;
  }
};

const request = (
  method: HttpVerb,
  url: string | URL,
  options: Options = {},
): Response => {
  const originalMethod = normalizeMethod(method);
  const originalUrl = v.parse(requestUrlSchema, url);
  const originalOptions = v.parse(optionsSchema, options);

  if (!canRetryRequest(originalMethod, originalOptions.retry)) {
    return performRequestAttempt(originalMethod, originalUrl, originalOptions);
  }

  const retry = originalOptions.retry;
  const maxRetries = originalOptions.maxRetries ?? defaultMaxRetries;

  for (let retries = 0; ; retries += 1) {
    const attemptNumber = retries + 1;
    let retryError: CurlError | null = null;
    let retryResponse: Response | undefined;

    try {
      const response = performRequestAttempt(
        originalMethod,
        originalUrl,
        originalOptions,
      );
      if (
        !shouldRetryRequest(retry, null, response, attemptNumber) ||
        retries >= maxRetries
      ) {
        return response;
      }
      retryResponse = response;
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
        originalOptions.retryDelay,
        retryError,
        retryResponse,
        attemptNumber,
      ),
    );
  }
};

export default request;
