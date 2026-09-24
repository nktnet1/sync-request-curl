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
  const maxRedirects = options.maxRedirects ?? -1;
  let redirectsFollowed = 0;
  let currentMethod = originalMethod;
  let currentUrl = originalUrl;
  let currentOptions = options;

  while (true) {
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
    if (!redirectUrl) return response;

    if (maxRedirects >= 0 && redirectsFollowed >= maxRedirects) {
      throw new RequestError(
        "ERR_TOO_MANY_REDIRECTS",
        "Request failed: Number of redirects hit maximum amount",
      );
    }
    redirectsFollowed += 1;

    const nextUrl = new URL(redirectUrl, response.url).href;
    const nextMethod = getRedirectMethod(currentMethod, response.statusCode);
    const sameOrigin = new URL(response.url).origin === new URL(nextUrl).origin;

    currentOptions = getRedirectOptions(
      currentOptions,
      nextMethod !== currentMethod,
      sameOrigin,
    );
    currentMethod = nextMethod;
    currentUrl = nextUrl;
  }
};

export default request;
