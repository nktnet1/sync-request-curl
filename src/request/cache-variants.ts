import {
  type CacheEntry,
  copyRequestHeaders,
  getHeaderValues,
  type NormalizedRequestHeaders,
  toCachedResponse,
} from "#/request/cache-types";
import type { Options, Response } from "#/types/definition";

const getRequestHeaderValues = (
  requestHeaders: NormalizedRequestHeaders,
  name: string,
): string[] | undefined => {
  const normalizedName = name.toLowerCase();
  return Object.entries(requestHeaders).find(
    ([headerName]) => headerName === normalizedName,
  )?.[1];
};

export const getRequestHeaderValue = (
  requestHeaders: NormalizedRequestHeaders,
  name: string,
): string | undefined => {
  const values = getRequestHeaderValues(requestHeaders, name);
  return values === undefined ? undefined : values.join(", ");
};

export const stringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightValues = right.values();
  return left.every((value) => value === rightValues.next().value);
};

export const varyRequestHeadersMatch = (
  varyNames: string[],
  left: NormalizedRequestHeaders,
  right: NormalizedRequestHeaders,
): boolean =>
  varyNames.every((name) =>
    stringArraysEqual(
      getRequestHeaderValues(left, name) ?? [],
      getRequestHeaderValues(right, name) ?? [],
    ),
  );

export const getVaryNamesFromHeaders = (
  headers: Response["headers"],
): string[] =>
  [
    ...new Set(
      getHeaderValues(headers, "vary")
        .flatMap((value) => value.split(","))
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

export const getVaryNames = (entry: CacheEntry): string[] =>
  getVaryNamesFromHeaders(entry.headers);

export const requestMatchesEntry = (
  entry: CacheEntry,
  requestHeaders: NormalizedRequestHeaders,
): boolean => {
  const varyNames = getVaryNames(entry);
  if (varyNames.includes("*")) {
    return false;
  }

  return varyRequestHeadersMatch(
    varyNames,
    requestHeaders,
    entry.requestHeaders,
  );
};

export const matchesCachePolicy = (
  entry: CacheEntry,
  requestHeaders: NormalizedRequestHeaders,
  policy: Pick<Options, "isMatch">,
): boolean => {
  const defaultValue = requestMatchesEntry(entry, requestHeaders);
  return policy.isMatch
    ? policy.isMatch(
        copyRequestHeaders(requestHeaders),
        toCachedResponse(entry),
        defaultValue,
      )
    : defaultValue;
};
