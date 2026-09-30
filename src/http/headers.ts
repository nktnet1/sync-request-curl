import { validateHeaderName, validateHeaderValue } from "node:http";
import * as v from "valibot";
import { RequestError, RetryableRequestError } from "#/errors";
import type { Options, Response } from "#/types/definition";
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

/**
 * Converts Node-style request headers into the line format used by the native
 * transport.
 */
const invalidHostHeaderArray = (): never => {
  const error = new TypeError(
    'The "options.headers.host" property must be of type string. Received an instance of Array',
  ) as TypeError & { code?: string };
  error.code = "ERR_INVALID_ARG_TYPE";
  throw error;
};

const formatRequestHeader = (name: string, value: string): string =>
  value === "" ? `${name};` : `${name}: ${value}`;

const serializeRequestHeaderArray = (
  name: string,
  normalizedName: string,
  values: string[],
): string[] => {
  if (normalizedName === "host") {
    invalidHostHeaderArray();
  }

  for (const value of values) {
    validateHeaderValue(name, value);
  }

  if (normalizedName === "cookie") {
    return values.length === 0 ? [] : [`${name}: ${values.join("; ")}`];
  }

  return values.map((value) => formatRequestHeader(name, value));
};

function validateRequestHeaderValue(
  name: string,
  value: string | undefined,
): asserts value is string {
  // IncomingHttpHeaders permits undefined, but Node rejects it outbound.
  validateHeaderValue(name, value as string);
}

const serializeRequestHeaderValue = (
  name: string,
  value: string | undefined,
): string[] => {
  validateRequestHeaderValue(name, value);
  return [formatRequestHeader(name, value)];
};

export const serializeRequestHeaders = (
  headers?: NonNullable<Options["headers"]>,
): string[] => {
  if (!headers) {
    return [];
  }

  const serialized: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    validateHeaderName(name);
    const normalizedName = name.toLowerCase();
    serialized.push(
      ...(Array.isArray(value)
        ? serializeRequestHeaderArray(name, normalizedName, value)
        : serializeRequestHeaderValue(name, value)),
    );
  }
  return serialized;
};

const isAsciiDigit = (character: string): boolean =>
  character >= "0" && character <= "9";

const getHttpStatusCode = (header: string): number | undefined => {
  if (header.slice(0, 5).toUpperCase() !== "HTTP/") {
    return undefined;
  }

  const versionEnd = header.indexOf(" ", 5);
  if (versionEnd < 6) {
    return undefined;
  }

  let hasVersionDigit = false;
  for (let i = 5; i < versionEnd; i += 1) {
    const character = header.charAt(i);
    if (isAsciiDigit(character)) {
      hasVersionDigit = true;
    } else if (character !== ".") {
      return undefined;
    }
  }
  if (!hasVersionDigit) {
    return undefined;
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
    return undefined;
  }

  const boundary = header.charAt(statusStart + 3);
  if (boundary !== "" && boundary !== " " && boundary !== "\t") {
    return undefined;
  }

  return Number(header.slice(statusStart, statusStart + 3));
};

const isHttpStatusLine = (header: string): boolean =>
  getHttpStatusCode(header) !== undefined;

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
  throw new RetryableRequestError(
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

  if (values.length !== 1 || values[0].includes(",")) {
    invalidResponseFraming("multiple Content-Length values are not allowed");
  }

  normalizeContentLengthValue(values[0]);
  return values[0];
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
      ? "multiple Content-Length values are not allowed"
      : "invalid Content-Length",
  );
};

const invalidResponseHeaders = (message: string, cause?: unknown): never => {
  throw new RetryableRequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid response headers: ${message}`,
    cause === undefined ? undefined : { cause },
  );
};

const trimOptionalWhitespace = (value: string): string => {
  let begin = 0;
  while (value.charAt(begin) === " " || value.charAt(begin) === "\t") {
    begin += 1;
  }

  let end = value.length;
  while (
    end > begin &&
    (value.charAt(end - 1) === " " || value.charAt(end - 1) === "\t")
  ) {
    end -= 1;
  }

  return value.slice(begin, end);
};

interface ParsedResponseHeaderLine {
  name: string;
  value: string;
}

const parseResponseHeaderLine = (header: string): ParsedResponseHeaderLine => {
  const separatorIndex = header.indexOf(":");
  if (separatorIndex <= 0) {
    invalidResponseHeaders("malformed header line");
  }

  const rawName = header.slice(0, separatorIndex);
  const rawValue = header.slice(separatorIndex + 1);

  try {
    validateHeaderName(rawName);
  } catch (error) {
    invalidResponseHeaders("invalid header name", error);
  }

  try {
    validateHeaderValue(rawName, rawValue);
  } catch (error) {
    invalidResponseHeaders(`invalid value for ${rawName}`, error);
  }

  return {
    name: rawName.toLowerCase(),
    value: trimOptionalWhitespace(rawValue),
  };
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

// CURLE_WRITE_ERROR from libcurl.
const curlWriteErrorCode = 23;
const responseHeaderOverflowTransportMessage =
  "Response headers exceeded the configured size limit";

export const throwForResponseHeaderTransportError = (
  transportCode: number,
  transportMessage: string,
): void => {
  if (
    transportCode === curlWriteErrorCode &&
    transportMessage === responseHeaderOverflowTransportMessage
  ) {
    throw new RetryableRequestError(
      "ERR_REQUEST_FAILED",
      "Request failed: Parse Error: Header overflow",
    );
  }
};

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

interface ResponseHeaderSections {
  blocks: string[][];
  detachedLines: string[];
}

const splitHeaderLinesWithoutStatus = (
  headerLines: string[],
): ResponseHeaderSections => {
  const headerEndIndex = headerLines.indexOf("");
  return {
    blocks: [
      headerEndIndex >= 0
        ? headerLines.slice(0, headerEndIndex)
        : headerLines.slice(),
    ],
    detachedLines:
      headerEndIndex >= 0 ? headerLines.slice(headerEndIndex + 1) : [],
  };
};

const canStartResponseHeaderBlock = (
  statusCode: number | undefined,
  allowAnotherResponseBlock: boolean,
  currentHeaders: string[] | undefined,
): statusCode is number =>
  statusCode !== undefined &&
  allowAnotherResponseBlock &&
  currentHeaders === undefined;

const canFollowResponseHeaderBlock = (
  statusCode: number | undefined,
): boolean =>
  statusCode !== undefined &&
  ((statusCode >= 100 && statusCode < 200) ||
    redirectStatusCodes.has(statusCode));

const splitResponseHeaderSections = (
  headerLines: string[],
): ResponseHeaderSections => {
  if (!headerLines.some(isHttpStatusLine)) {
    return splitHeaderLinesWithoutStatus(headerLines);
  }

  const blocks: string[][] = [];
  const detachedLines: string[] = [];
  let currentHeaders: string[] | undefined;
  let currentStatusCode: number | undefined;
  let allowAnotherResponseBlock = true;

  for (const line of headerLines) {
    const statusCode = getHttpStatusCode(line);
    if (
      canStartResponseHeaderBlock(
        statusCode,
        allowAnotherResponseBlock,
        currentHeaders,
      )
    ) {
      currentHeaders = [];
      currentStatusCode = statusCode;
      continue;
    }

    if (line === "") {
      if (currentHeaders === undefined) {
        continue;
      }
      blocks.push(currentHeaders);
      allowAnotherResponseBlock =
        canFollowResponseHeaderBlock(currentStatusCode);
      currentHeaders = undefined;
      currentStatusCode = undefined;
      continue;
    }

    if (currentHeaders === undefined) {
      detachedLines.push(line);
      continue;
    }
    currentHeaders.push(line);
  }

  if (currentHeaders !== undefined) {
    blocks.push(currentHeaders);
  }

  return { blocks, detachedLines };
};

const unfoldResponseHeaderLines = (headerLines: string[]): string[] => {
  const unfoldedLines: string[] = [];

  for (const line of headerLines) {
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      unfoldedLines.push(line);
      continue;
    }

    // libcurl 8.18+ unfolds obs-fold before the header callback. Older
    // versions expose continuation lines, so normalise them here as well.
    const previousLine = unfoldedLines.pop();
    if (previousLine === undefined || previousLine === "") {
      invalidResponseHeaders("malformed header line");
    }

    unfoldedLines.push(`${previousLine} ${trimOptionalWhitespace(line)}`);
  }

  return unfoldedLines;
};

const parseResponseHeaderBlock = (
  headerLines: string[],
): Response["headers"] => {
  const parsedHeaders = new Map<string, string | string[]>();
  const contentLengthValues: string[] = [];
  let hasTransferEncoding = false;

  for (const header of unfoldResponseHeaderLines(headerLines)) {
    const { name, value } = parseResponseHeaderLine(header);
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

/**
 * Validates every response header block and trailer line, while exposing only
 * the final response header block like Node's IncomingMessage.
 */
export const parseResponseHeaders = (
  headerLines: string[],
): Response["headers"] => {
  const { blocks, detachedLines } = splitResponseHeaderSections(headerLines);
  let finalHeaders: Response["headers"] = {};

  for (const block of blocks) {
    finalHeaders = parseResponseHeaderBlock(block);
  }

  for (const line of unfoldResponseHeaderLines(detachedLines)) {
    if (line !== "") {
      parseResponseHeaderLine(line);
    }
  }

  return finalHeaders;
};
