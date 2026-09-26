import type { IncomingHttpHeaders } from "node:http";
import * as v from "valibot";
import { RequestError } from "#/errors";
import type { Options, UppercaseHttpVerb } from "#/types";
import { incomingHttpHeadersSchema } from "#/validation";

export const getRedirectMethod = (
  method: UppercaseHttpVerb,
  statusCode: number,
): UppercaseHttpVerb => {
  if (statusCode === 303 && method !== "HEAD") {
    return "GET";
  }
  if ((statusCode === 301 || statusCode === 302) && method === "POST") {
    return "GET";
  }
  return method;
};

const withoutPayload = (options: Options): Options => ({
  ...options,
  json: undefined,
  body: undefined,
  form: undefined,
});

const getRedirectHeaders = (
  headers: IncomingHttpHeaders | undefined,
  allowRedirectHeaders: string[] | undefined,
): IncomingHttpHeaders | undefined => {
  if (!headers || !allowRedirectHeaders || allowRedirectHeaders.length === 0) {
    return undefined;
  }

  const allowedNames = new Set(
    allowRedirectHeaders.map((name) => name.toLowerCase()),
  );
  const entries = Object.entries(headers).filter(([name]) =>
    allowedNames.has(name.toLowerCase()),
  );
  return entries.length > 0
    ? v.parse(incomingHttpHeadersSchema, Object.fromEntries(entries))
    : undefined;
};

export const getRedirectOptions = (
  options: Options,
  methodChanged: boolean,
): Options => ({
  ...(methodChanged ? withoutPayload(options) : options),
  qs: undefined,
  headers: getRedirectHeaders(options.headers, options.allowRedirectHeaders),
});

export const getRemainingTimeout = (
  timeout: number,
  startedAt: number,
): number => {
  const remaining = timeout - (Date.now() - startedAt);
  if (remaining <= 0) {
    throw new RequestError("ETIMEDOUT", "Request failed: Operation timed out");
  }
  return remaining;
};
