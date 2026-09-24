import { type FormDataEntry, getFormDataEntries } from "#/form-data";
import {
  serializeRequestHeaders,
  setContentLengthHeader,
  setRequestHeader,
} from "#/http/headers";
import { appendQueryString, normalizeUrlHostname } from "#/http/url";
import type { Options } from "#/types";

export interface PreparedRequest {
  url: string;
  headers: string[];
  body?: string | Buffer;
  form?: FormDataEntry[];
}

const preparePayload = (
  options: Options,
  headers: string[],
): Pick<PreparedRequest, "body" | "form"> => {
  if (options.json !== undefined) {
    const body = JSON.stringify(options.json);
    if (body === undefined) {
      throw new TypeError("The json option must be JSON-serializable");
    }
    setRequestHeader(headers, "Content-Type", "application/json");
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

  if (options.form) {
    return { form: getFormDataEntries(options.form) };
  }

  setContentLengthHeader(headers, 0);
  return {};
};

const prepareUrl = (url: string, options: Options): string => {
  const withQuery =
    options.qs && Object.keys(options.qs).length > 0
      ? appendQueryString(url, options.qs)
      : url;
  return normalizeUrlHostname(withQuery);
};

export const prepareRequest = (
  url: string,
  options: Options,
): PreparedRequest => {
  const headers = serializeRequestHeaders(options.headers);

  return {
    url: prepareUrl(url, options),
    headers,
    ...preparePayload(options, headers),
  };
};
