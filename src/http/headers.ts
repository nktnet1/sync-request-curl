import * as v from "valibot";
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

export const setRequestHeader = (
  headers: string[],
  name: string,
  value: string | number,
): void => {
  removeRequestHeader(headers, name);
  headers.push(`${name}: ${value}`);
};

export const setContentLengthHeader = (
  headers: string[],
  length: number,
): void => {
  if (
    hasRequestHeader(headers, "content-length") ||
    hasRequestHeader(headers, "transfer-encoding")
  ) {
    return;
  }
  setRequestHeader(headers, "Content-Length", length);
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
    if (value === undefined) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      serialized.push(item === "" ? `${name};` : `${name}: ${item}`);
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

/** Parses the final response header block and preserves repeated headers. */
export const parseResponseHeaders = (
  headerLines: string[],
): Response["headers"] => {
  const finalStatusLineIndex = findFinalStatusLineIndex(headerLines);
  const finalHeaderLines =
    finalStatusLineIndex >= 0
      ? headerLines.slice(finalStatusLineIndex + 1)
      : headerLines;
  const parsedHeaders = new Map<string, string | string[]>();

  for (const header of finalHeaderLines) {
    const separatorIndex = header.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = header.slice(0, separatorIndex).trim().toLowerCase();
    const value = header.slice(separatorIndex + 1).trim();
    const existingValue = parsedHeaders.get(name);

    if (existingValue === undefined) {
      parsedHeaders.set(name, value);
    } else if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      parsedHeaders.set(name, [existingValue, value]);
    }
  }

  return v.parse(incomingHttpHeadersSchema, Object.fromEntries(parsedHeaders));
};
