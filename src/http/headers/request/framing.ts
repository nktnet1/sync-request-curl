import { RequestError } from "#/errors";
import {
  hasRequestHeader,
  parseRequestHeaderLine,
  setRequestHeader,
} from "#/http/headers/request/headers";

export const invalidRequestFraming = (message: string): never => {
  throw new RequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid request framing: ${message}`,
  );
};

export const validateRequestFraming = (headers: string[]): void => {
  const transferCodings = headers.flatMap((header) => {
    const parsed = parseRequestHeaderLine(header);
    return parsed?.name === "transfer-encoding"
      ? [parsed.value.toLowerCase()]
      : [];
  });
  if (
    transferCodings.length > 0 &&
    (transferCodings.length !== 1 || transferCodings[0] !== "chunked")
  ) {
    invalidRequestFraming(
      "only a single chunked Transfer-Encoding is supported",
    );
  }
  if (
    hasRequestHeader(headers, "content-length") &&
    hasRequestHeader(headers, "transfer-encoding")
  ) {
    invalidRequestFraming(
      "Content-Length cannot be combined with Transfer-Encoding",
    );
  }
};

export const rejectMultipartContentLength = (headers: string[]): void => {
  if (hasRequestHeader(headers, "content-length")) {
    invalidRequestFraming(
      "Content-Length cannot be supplied with multipart form payloads",
    );
  }
};

const normalizeRequestContentLength = (value: string): string => {
  if (value.length === 0) {
    invalidRequestFraming("invalid Content-Length");
  }

  for (const character of value) {
    if (character < "0" || character > "9") {
      invalidRequestFraming("invalid Content-Length");
    }
  }

  return value.replace(/^0+(?=\d)/, "");
};

export const setContentLengthHeader = (
  headers: string[],
  length: number,
  generateIfMissing = true,
): void => {
  if (hasRequestHeader(headers, "transfer-encoding")) {
    return;
  }

  const contentLengthValues = headers.flatMap((header) => {
    const parsed = parseRequestHeaderLine(header);
    return parsed?.name === "content-length" ? [parsed.value] : [];
  });

  if (contentLengthValues.length === 0) {
    if (generateIfMissing) {
      setRequestHeader(headers, "Content-Length", length);
    }
    return;
  }

  if (contentLengthValues.length > 1) {
    invalidRequestFraming("multiple Content-Length fields are not allowed");
  }

  for (const contentLengthValue of contentLengthValues) {
    const contentLength = normalizeRequestContentLength(contentLengthValue);
    if (contentLength !== String(length)) {
      invalidRequestFraming(
        `Content-Length does not match the request body length (${length})`,
      );
    }
  }
};
