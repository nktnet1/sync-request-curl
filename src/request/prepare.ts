import * as v from "valibot";
import { getFormDataEntries } from "#/form-data";
import {
  hasRequestHeader,
  serializeRequestHeaders,
  setContentLengthHeader,
  setRequestHeader,
  validateRequestFraming,
} from "#/http/headers";
import { appendQueryString, normalizeUrlHostname } from "#/http/url";
import type { NativeRequestOptions } from "#/native/index";
import type { Options, UppercaseHttpVerb } from "#/types";

export type PreparedRequest = Pick<
  NativeRequestOptions,
  "url" | "headers" | "body" | "form"
>;

const jsonBodySchema = v.pipe(
  v.unknown(),
  v.stringifyJson(undefined, "The json option must be JSON-serializable"),
);

const preparePayload = (
  method: UppercaseHttpVerb,
  options: Options,
  headers: string[],
): Pick<PreparedRequest, "body" | "form"> => {
  if (options.form) {
    return { form: getFormDataEntries(options.form) };
  }

  if (options.json !== undefined) {
    const body = v.parse(jsonBodySchema, options.json);
    if (!hasRequestHeader(headers, "content-type")) {
      setRequestHeader(headers, "Content-Type", "application/json");
    }
    setContentLengthHeader(headers, Buffer.byteLength(body));
    return { body };
  }

  if (options.body !== undefined) {
    const body = options.body;
    const length = Buffer.isBuffer(body)
      ? body.length
      : Buffer.byteLength(body, "utf8");
    setContentLengthHeader(headers, length);
    return { body };
  }

  if (!["GET", "DELETE", "HEAD"].includes(method)) {
    setContentLengthHeader(headers, 0);
  }
  return {};
};

const prepareUrl = (url: string, options: Options): string => {
  const withQuery = options.qs ? appendQueryString(url, options.qs) : url;
  return normalizeUrlHostname(withQuery);
};

export const prepareRequest = (
  url: string,
  options: Options,
  method: UppercaseHttpVerb = "POST",
): PreparedRequest => {
  const headers = serializeRequestHeaders(options.headers);
  validateRequestFraming(headers);

  if (options.gzip !== false && !hasRequestHeader(headers, "accept-encoding")) {
    setRequestHeader(headers, "Accept-Encoding", "gzip, deflate");
  }

  return {
    url: prepareUrl(url, options),
    headers,
    ...preparePayload(method, options, headers),
  };
};
