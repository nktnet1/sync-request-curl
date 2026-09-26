import { validateHeaderName, validateHeaderValue } from "node:http";
import * as v from "valibot";
import { RequestError } from "#/errors";
import type { Options, Response } from "#/types";
import { incomingHttpHeadersSchema } from "#/validation";

const getRequestHeaderDelimiterIndex = (header: string): number => {
  const colonIndex = header.indexOf(":");
  const semicolonIndex = header.indexOf(";");
  if (colonIndex < 0 || (semicolonIndex >= 0 && semicolonIndex < colonIndex)) {
    return semicolonIndex;
  }
  return colonIndex;
};

const getHeaderName = (header: string): string => {
  const delimiterIndex = getRequestHeaderDelimiterIndex(header);
  const endIndex = delimiterIndex < 0 ? header.length : delimiterIndex;
  return header.slice(0, endIndex).trim().toLowerCase();
};

export interface ParsedRequestHeaderLine {
  name: string;
  value: string;
}

export const parseRequestHeaderLine = (
  header: string,
): ParsedRequestHeaderLine | undefined => {
  const delimiterIndex = getRequestHeaderDelimiterIndex(header);
  if (delimiterIndex <= 0) {
    return undefined;
  }

  return {
    name: header.slice(0, delimiterIndex).trim().toLowerCase(),
    value:
      header.charAt(delimiterIndex) === ";"
        ? ""
        : header.slice(delimiterIndex + 1).trim(),
  };
};

const removeRequestHeader = (headers: string[], name: string): void => {
  const normalizedName = name.toLowerCase();
  const retainedHeaders = headers.filter(
    (header) => getHeaderName(header) !== normalizedName,
  );
  headers.splice(0, headers.length, ...retainedHeaders);
};

export const hasRequestHeader = (headers: string[], name: string): boolean => {
  const normalizedName = name.toLowerCase();
  return headers.some((header) => getHeaderName(header) === normalizedName);
};

export const hasNonEmptyRequestHeader = (
  headers: string[],
  name: string,
): boolean => {
  const normalizedName = name.toLowerCase();
  return headers.some((header) => {
    const parsed = parseRequestHeaderLine(header);
    return parsed?.name === normalizedName && parsed.value.length > 0;
  });
};

export const setRequestHeader = (
  headers: string[],
  name: string,
  value: string | number,
): void => {
  removeRequestHeader(headers, name);
  headers.push(`${name}: ${value}`);
};

const invalidRequestFraming = (message: string): never => {
  throw new RequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid request framing: ${message}`,
  );
};

export const validateRequestFraming = (headers: string[]): void => {
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

/**
 * Converts Node-style request headers into the line format used by the native
 * transport.
 */
export const serializeRequestHeaders = (
  headers?: NonNullable<Options["headers"]>,
): string[] => {
  if (!headers) {
    return [];
  }

  const serialized: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    validateHeaderName(name);

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      // IncomingHttpHeaders permits undefined, but Node rejects it outbound.
      validateHeaderValue(name, item as string);
      if (item !== undefined) {
        serialized.push(item === "" ? `${name};` : `${name}: ${item}`);
      }
    }
  }
  return serialized;
};

const isAsciiDigit = (character: string): boolean =>
  character >= "0" && character <= "9";

const isHttpStatusLine = (header: string): boolean => {
  if (header.slice(0, 5).toUpperCase() !== "HTTP/") {
    return false;
  }

  const versionEnd = header.indexOf(" ", 5);
  if (versionEnd < 6) {
    return false;
  }

  let hasVersionDigit = false;
  for (let i = 5; i < versionEnd; i += 1) {
    const character = header.charAt(i);
    if (isAsciiDigit(character)) {
      hasVersionDigit = true;
    } else if (character !== ".") {
      return false;
    }
  }
  if (!hasVersionDigit) {
    return false;
  }

  let statusStart = versionEnd + 1;
  while (
    header.charAt(statusStart) === " " ||
    header.charAt(statusStart) === "\t"
  ) {
    statusStart += 1;
  }

  if (
    !isAsciiDigit(header.charAt(statusStart)) ||
    !isAsciiDigit(header.charAt(statusStart + 1)) ||
    !isAsciiDigit(header.charAt(statusStart + 2))
  ) {
    return false;
  }

  const boundary = header.charAt(statusStart + 3);
  return boundary === "" || boundary === " " || boundary === "\t";
};

const findFinalStatusLineIndex = (headerLines: string[]): number => {
  let finalStatusLineIndex = -1;

  for (const [index, headerLine] of headerLines.entries()) {
    if (isHttpStatusLine(headerLine)) {
      finalStatusLineIndex = index;
    }
  }

  return finalStatusLineIndex;
};

const getFinalResponseHeaderLines = (headerLines: string[]): string[] => {
  const finalStatusLineIndex = findFinalStatusLineIndex(headerLines);
  const finalBlock =
    finalStatusLineIndex >= 0
      ? headerLines.slice(finalStatusLineIndex + 1)
      : headerLines;
  const headerEndIndex = finalBlock.indexOf("");

  return headerEndIndex >= 0 ? finalBlock.slice(0, headerEndIndex) : finalBlock;
};

const singletonResponseHeaders = new Set([
  "age",
  "authorization",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "server",
  "user-agent",
]);

const invalidResponseFraming = (message: string): never => {
  throw new RequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid response framing: ${message}`,
  );
};

const normalizeContentLengthValue = (value: string): string => {
  if (value.length === 0) {
    invalidResponseFraming("invalid Content-Length");
  }

  for (const character of value) {
    if (!isAsciiDigit(character)) {
      invalidResponseFraming("invalid Content-Length");
    }
  }

  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized;
};

const validateAndNormalizeContentLength = (
  values: string[],
): string | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  const candidates = values.flatMap((value) => value.split(","));
  let first: string | undefined;
  let normalizedFirst: string | undefined;

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const normalized = normalizeContentLengthValue(trimmed);

    if (first === undefined) {
      first = trimmed;
      normalizedFirst = normalized;
      continue;
    }

    if (normalized !== normalizedFirst) {
      invalidResponseFraming("conflicting Content-Length values");
    }
  }

  return first;
};

export const throwForResponseFramingTransportError = (
  transportCode: number,
  transportMessage: string,
  headerLines: string[],
): void => {
  if (
    transportCode !== 8 ||
    !transportMessage.includes("Invalid Content-Length")
  ) {
    return;
  }

  const finalHeaderLines = getFinalResponseHeaderLines(headerLines);
  const capturedContentLength = finalHeaderLines.some((header) => {
    const separatorIndex = header.indexOf(":");
    return (
      separatorIndex > 0 &&
      header.slice(0, separatorIndex).trim().toLowerCase() === "content-length"
    );
  });

  invalidResponseFraming(
    capturedContentLength
      ? "conflicting Content-Length values"
      : "invalid Content-Length",
  );
};

const appendResponseHeader = (
  parsedHeaders: Map<string, string | string[]>,
  name: string,
  value: string,
): void => {
  if (name === "set-cookie") {
    const existingValue = parsedHeaders.get(name);
    if (existingValue === undefined) {
      parsedHeaders.set(name, [value]);
    } else {
      (existingValue as string[]).push(value);
    }
    return;
  }

  const existingValue = parsedHeaders.get(name);
  if (existingValue === undefined) {
    parsedHeaders.set(name, value);
    return;
  }

  if (name === "cookie") {
    parsedHeaders.set(name, `${existingValue as string}; ${value}`);
  } else if (!singletonResponseHeaders.has(name)) {
    parsedHeaders.set(name, `${existingValue as string}, ${value}`);
  }
};

/** Parses the final response header block using Node IncomingMessage folding. */
export const parseResponseHeaders = (
  headerLines: string[],
): Response["headers"] => {
  const finalHeaderLines = getFinalResponseHeaderLines(headerLines);
  const parsedHeaders = new Map<string, string | string[]>();
  const contentLengthValues: string[] = [];
  let hasTransferEncoding = false;

  for (const header of finalHeaderLines) {
    const separatorIndex = header.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = header.slice(0, separatorIndex).trim().toLowerCase();
    const value = header.slice(separatorIndex + 1).trim();
    if (name === "content-length") {
      contentLengthValues.push(value);
      continue;
    }
    if (name === "transfer-encoding") {
      hasTransferEncoding = true;
    }
    appendResponseHeader(parsedHeaders, name, value);
  }

  const contentLength = validateAndNormalizeContentLength(contentLengthValues);
  if (contentLength !== undefined) {
    if (hasTransferEncoding) {
      invalidResponseFraming(
        "Content-Length cannot be combined with Transfer-Encoding",
      );
    }
    parsedHeaders.set("content-length", contentLength);
  }

  return v.parse(incomingHttpHeadersSchema, Object.fromEntries(parsedHeaders));
};
