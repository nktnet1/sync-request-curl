import { RequestError } from "#/errors";
import type { Options, UppercaseHttpVerb } from "#/types";

export const getRedirectMethod = (
  method: UppercaseHttpVerb,
  statusCode: number,
): UppercaseHttpVerb => {
  if (statusCode === 303 && method !== "HEAD") return "GET";
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

export const getRedirectOptions = (
  options: Options,
  methodChanged: boolean,
  sameOrigin: boolean,
): Options => ({
  ...(methodChanged ? withoutPayload(options) : options),
  qs: undefined,
  headers: sameOrigin ? options.headers : undefined,
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
