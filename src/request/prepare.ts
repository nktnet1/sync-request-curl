import * as v from "valibot";
import { RequestError } from "#/errors";
import { hasSafeAuthCredentials, usesNegotiatedAuth } from "#/http/auth";
import {
  hasNonEmptyRequestHeader,
  hasRequestHeader,
  rejectMultipartContentLength,
  serializeRequestHeaders,
  setContentLengthHeader,
  setRequestHeader,
  validateRequestFraming,
} from "#/http/headers";
import {
  appendQueryString,
  assertSupportedHttpUrl,
  normalizeUrlHostname,
  stripUrlCredentials,
} from "#/http/url";
import type { NativeRequestOptions } from "#/native/index";
import type { Options, UppercaseHttpVerb } from "#/types/definition";
import { parseSchema } from "#/validate";

export type PreparedRequest = Pick<
  NativeRequestOptions,
  "url" | "headers" | "body"
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

const payloadHasContent = (payload: Pick<PreparedRequest, "body">): boolean => {
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
  payload: Pick<PreparedRequest, "body">,
): void => {
  if (!payloadHasContent(payload)) {
    return;
  }

  if (method === "TRACE") {
    invalidRequestSemantics("TRACE requests cannot contain content");
  }

  if (method === "OPTIONS") {
    const hasContentTypeValue = hasNonEmptyRequestHeader(
      headers,
      "content-type",
    );
    if (!hasContentTypeValue) {
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
): Pick<PreparedRequest, "body"> => {
  if (options.form) {
    rejectMultipartContentLength(headers);
    if (!hasRequestHeader(headers, "content-type")) {
      const contentType = options.form.getHeaders()["content-type"];
      setRequestHeader(headers, "Content-Type", contentType);
    }
    const body = options.form.getBuffer();
    setContentLengthHeader(headers, body.length);
    return { body };
  }

  if (options.json !== undefined) {
    const body = parseSchema(jsonBodySchema, options.json);
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
  assertSupportedHttpUrl(withQuery);
  return normalizeUrlHostname(withQuery);
};

export const prepareRequest = (
  url: string,
  options: Options,
  method: UppercaseHttpVerb = "POST",
): PreparedRequest => {
  const headers = serializeRequestHeaders(options.headers);
  validateRequestFraming(headers);
  if (
    options.auth !== undefined &&
    hasRequestHeader(headers, "authorization")
  ) {
    invalidRequestSemantics(
      "auth cannot be combined with an explicit Authorization header",
    );
  }
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
  if (
    method === "HEAD" &&
    payload.body !== undefined &&
    (usesNegotiatedAuth(options.auth?.type) ||
      usesNegotiatedAuth(options.proxy?.auth))
  ) {
    invalidRequestSemantics(
      "HEAD requests with a payload cannot use negotiated authentication; " +
        "omit the payload or use preemptive Basic/Bearer authentication",
    );
  }

  let preparedUrl = prepareUrl(url, options);
  const target = new URL(preparedUrl);
  const hasUrlCredentials = target.username !== "" || target.password !== "";
  if (options.auth !== undefined && hasUrlCredentials) {
    invalidRequestSemantics("auth cannot be combined with URL credentials");
  }
  if (hasRequestHeader(headers, "authorization")) {
    // Explicit Authorization wins. Discard dormant Basic credentials before
    // libcurl can retain them in the effective URL used for relative redirects.
    preparedUrl = stripUrlCredentials(preparedUrl);
  } else if (
    hasUrlCredentials &&
    !hasSafeAuthCredentials(
      decodeURIComponent(target.username),
      decodeURIComponent(target.password),
      "basic",
    )
  ) {
    invalidRequestSemantics("Invalid URL credentials for basic authentication");
  }

  return {
    url: preparedUrl,
    headers,
    ...payload,
  };
};
