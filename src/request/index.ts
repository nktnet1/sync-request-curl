import { URL } from "node:url";
import * as v from "valibot";
import { RequestError } from "#/errors";
import { assertSupportedHttpUrl } from "#/http/url";
import { performRequest } from "#/request/perform";
import {
  getRedirectMethod,
  getRedirectOptions,
  getRemainingTimeout,
} from "#/request/redirects";
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
    assertSupportedHttpUrl(currentUrl);

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
  const originalOptions = v.parse(optionsSchema, options ?? {});

  return performRequestAttempt(originalMethod, originalUrl, originalOptions);
};

export default request;
