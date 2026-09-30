import { URL } from "node:url";
import * as v from "valibot";
import { RequestError } from "#/errors";
import { assertSupportedHttpUrl } from "#/http/url";
import { createDeadline } from "#/request/deadline";
import { performRequest } from "#/request/perform";
import { getRedirectMethod, getRedirectOptions } from "#/request/redirects";
import type {
  HttpVerb,
  Options,
  Response,
  UppercaseHttpVerb,
} from "#/types/definition";
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
  remaining: () => number,
): Response => {
  if (originalOptions.followRedirects === false) {
    return performRequest(
      originalMethod,
      originalUrl,
      originalOptions,
      remaining,
    ).response;
  }

  const redirectLimit = getRedirectLimit(originalOptions.maxRedirects);
  let currentMethod = originalMethod;
  let currentUrl = originalUrl;
  let currentOptions = originalOptions;

  for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
    assertSupportedHttpUrl(currentUrl);

    const { response, redirectUrl } = performRequest(
      currentMethod,
      currentUrl,
      currentOptions,
      remaining,
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

const normalizeLegacyOptions = (options: unknown): unknown => {
  if (options == null) return {};
  if (typeof options !== "object" || Array.isArray(options)) return options;
  return Object.fromEntries(
    Object.entries(options).map(([name, value]) => [
      name,
      ((name === "timeout" || name === "socketTimeout") && value === false) ||
      (name === "allowRedirectHeaders" && value === null)
        ? undefined
        : value,
    ]),
  );
};

/**
 * Perform a synchronous HTTP(S) request and return the complete buffered
 * response.
 *
 * @param method Recognised HTTP method. Matching is case-insensitive; `CONNECT`
 *   is rejected.
 * @param url Absolute `http:` or `https:` URL, provided as a string or `URL`.
 * @param options Request, transport, redirect, retry, and cache options.
 * @returns The buffered response after redirects and retries complete.
 * @group Request
 */
const request = (
  method: HttpVerb,
  url: string | URL,
  options: Options = {},
): Response => {
  const originalMethod = normalizeMethod(method);
  const originalUrl = v.parse(requestUrlSchema, url);
  const originalOptions = v.parse(
    optionsSchema,
    normalizeLegacyOptions(options),
  );

  const remaining = createDeadline(originalOptions.overallTimeout);
  const response = performRequestAttempt(
    originalMethod,
    originalUrl,
    originalOptions,
    remaining,
  );
  remaining();
  return response;
};

export default request;
