import type { IncomingHttpHeaders } from "node:http";

const getHeaderName = (header: string): string =>
  header.split(/[:;]/, 1)[0].trim().toLowerCase();

export const removeRequestHeader = (headers: string[], name: string): void => {
  const normalizedName = name.toLowerCase();
  for (let i = headers.length - 1; i >= 0; i -= 1) {
    if (getHeaderName(headers[i]) === normalizedName) {
      headers.splice(i, 1);
    }
  }
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
  if (hasRequestHeader(headers, "transfer-encoding")) {
    removeRequestHeader(headers, "content-length");
    return;
  }
  setRequestHeader(headers, "Content-Length", length);
};

/**
 * Converts Node-style request headers into the line format used by the native
 * transport.
 */
export const serializeRequestHeaders = (
  headers?: IncomingHttpHeaders,
): string[] => {
  if (!headers) return [];

  const serialized: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      serialized.push(item === "" ? `${name};` : `${name}: ${item}`);
    }
  }
  return serialized;
};

/** Parses the final response header block and preserves repeated headers. */
export const parseResponseHeaders = (
  headerLines: string[],
): IncomingHttpHeaders => {
  const finalStatusLineIndex = headerLines.findLastIndex((header) =>
    /^HTTP\/\d(?:\.\d+)?\s+\d{3}\b/i.test(header),
  );
  const finalHeaderLines =
    finalStatusLineIndex >= 0
      ? headerLines.slice(finalStatusLineIndex + 1)
      : headerLines;

  return finalHeaderLines.reduce((headers, header) => {
    const separatorIndex = header.indexOf(":");
    if (separatorIndex <= 0) return headers;

    const name = header.slice(0, separatorIndex).trim().toLowerCase();
    const value = header.slice(separatorIndex + 1).trim();
    const existingValue = headers[name];

    if (existingValue === undefined) {
      headers[name] = value;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      headers[name] = [existingValue, value];
    }

    return headers;
  }, {} as IncomingHttpHeaders);
};
