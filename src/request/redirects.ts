import type { Options, UppercaseHttpVerb } from "#/types/definition";
import type { Headers } from "#/types/headers";
import { parseSchema } from "#/validate";
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

// RFC 9110 section 15.4: a method rewrite must discard payload metadata,
// even when the caller allowed these fields through redirects.
const payloadHeaderNames = new Set([
  "content-encoding",
  "content-language",
  "content-location",
  "content-type",
  "content-length",
  "digest",
  "content-digest",
  "repr-digest",
  "last-modified",
  "transfer-encoding",
  "trailer",
  "expect",
]);

const getRedirectTls = (
  tls: Options["tls"],
  sameOrigin: boolean,
): Options["tls"] => {
  if (tls === undefined || sameOrigin) {
    return tls;
  }
  if (tls.minVersion === undefined && tls.maxVersion === undefined) {
    return undefined;
  }
  return {
    minVersion: tls.minVersion,
    maxVersion: tls.maxVersion,
  };
};

const getRedirectHeaders = (
  headers: Headers | undefined,
  allowRedirectHeaders: string[] | undefined,
  methodChanged: boolean,
): Headers | undefined => {
  if (!headers || !allowRedirectHeaders || allowRedirectHeaders.length === 0) {
    return undefined;
  }

  const allowedNames = new Set(
    allowRedirectHeaders.map((name) => name.toLowerCase()),
  );
  const entries = Object.entries(headers).filter(
    ([name]) =>
      allowedNames.has(name.toLowerCase()) &&
      !(methodChanged && payloadHeaderNames.has(name.toLowerCase())),
  );
  return entries.length > 0
    ? parseSchema(incomingHttpHeadersSchema, Object.fromEntries(entries))
    : undefined;
};

export const getRedirectOptions = (
  options: Options,
  methodChanged: boolean,
  sameOrigin = false,
): Options => ({
  ...(methodChanged ? withoutPayload(options) : options),
  auth: sameOrigin ? options.auth : undefined,
  tls: getRedirectTls(options.tls, sameOrigin),
  qs: undefined,
  headers: getRedirectHeaders(
    options.headers,
    options.allowRedirectHeaders,
    methodChanged,
  ),
});
