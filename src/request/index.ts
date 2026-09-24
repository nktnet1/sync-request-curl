import { URL } from "node:url";
import { RequestError } from "#/errors";
import { performRequest } from "#/request/perform";
import {
  getRedirectMethod,
  getRedirectOptions,
  getRemainingTimeout,
} from "#/request/redirects";
import type { HttpVerb, Options, Response, UppercaseHttpVerb } from "#/types";

const normalizeMethod = (method: HttpVerb): UppercaseHttpVerb =>
  method.toUpperCase() as UppercaseHttpVerb;

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

const request = (
  method: HttpVerb,
  url: string | URL,
  options: Options = {},
): Response => {
  const originalMethod = normalizeMethod(method);
  const originalUrl = typeof url === "string" ? url : url.href;

  if (options.followRedirects === false) {
    return performRequest(originalMethod, originalUrl, options).response;
  }

  const startedAt = Date.now();
  const redirectLimit = getRedirectLimit(options.maxRedirects);
  let currentMethod = originalMethod;
  let currentUrl = originalUrl;
  let currentOptions = options;

  for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
    if (options.timeout && options.timeout > 0) {
      currentOptions = {
        ...currentOptions,
        timeout: getRemainingTimeout(options.timeout, startedAt),
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

export default request;
