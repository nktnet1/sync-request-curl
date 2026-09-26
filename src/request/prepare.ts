import * as v from "valibot";
import { RequestError } from "#/errors";
import { getFormDataEntries } from "#/form-data";
import {
  hasNonEmptyRequestHeader,
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

const invalidRequestSemantics = (message: string): never => {
  throw new RequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid request semantics: ${message}`,
  );
};

const payloadHasContent = (
  payload: Pick<PreparedRequest, "body" | "form">,
): boolean => {
  if (payload.form !== undefined) {
    return true;
  }
  if (payload.body === undefined) {
    return false;
  }
  return Buffer.isBuffer(payload.body)
    ? payload.body.length > 0
    : Buffer.byteLength(payload.body) > 0;
};

const validateMethodSemantics = (
  method: UppercaseHttpVerb,
  headers: string[],
  payload: Pick<PreparedRequest, "body" | "form">,
): void => {
  if (!payloadHasContent(payload)) {
    return;
  }

  if (method === "TRACE") {
    invalidRequestSemantics("TRACE requests cannot contain content");
  }

  if (method === "OPTIONS") {
    const hasContentType = hasRequestHeader(headers, "content-type");
    const hasContentTypeValue = hasNonEmptyRequestHeader(
      headers,
      "content-type",
    );
    const nativeMultipartContentType =
      payload.form !== undefined && !hasContentType;

    if (!hasContentTypeValue && !nativeMultipartContentType) {
      invalidRequestSemantics(
        "OPTIONS requests with content require Content-Type",
      );
    }
  }
};

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

  setContentLengthHeader(
    headers,
    0,
    !["GET", "DELETE", "HEAD"].includes(method),
  );
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
  if (method === "CONNECT") {
    invalidRequestSemantics(
      "CONNECT is not supported by the buffered request API",
    );
  }

  if (options.gzip !== false && !hasRequestHeader(headers, "accept-encoding")) {
    setRequestHeader(headers, "Accept-Encoding", "gzip, deflate");
  }

  const payload = preparePayload(method, options, headers);
  validateMethodSemantics(method, headers, payload);

  return {
    url: prepareUrl(url, options),
    headers,
    ...payload,
  };
};
