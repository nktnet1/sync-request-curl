import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import {
  hasRequestHeader,
  parseRequestHeaderLine,
  setRequestHeader,
} from "#/http/headers";
import { fileCacheDirectory, getCachePath } from "#/request/cache-path";
import type { Response } from "#/types";
import { incomingHttpHeadersSchema } from "#/validation";

const cacheEntrySchema = v.object({
  statusCode: v.pipe(v.number(), v.integer()),
  headers: incomingHttpHeadersSchema,
  body: v.string(),
  responseUrl: v.string(),
  requestHeaders: v.record(v.string(), v.array(v.string())),
  requestTimestamp: v.pipe(v.number(), v.finite()),
  responseTimestamp: v.pipe(v.number(), v.finite()),
});

const cacheBucketSchema = v.object({
  version: v.literal(1),
  entries: v.array(cacheEntrySchema),
});

type CacheEntry = v.InferOutput<typeof cacheEntrySchema>;
type CacheBucket = v.InferOutput<typeof cacheBucketSchema>;
type NormalizedRequestHeaders = CacheEntry["requestHeaders"];

export interface FileCacheLookup {
  entry?: CacheEntry;
  requestHeaders: NormalizedRequestHeaders;
  requestTimestamp: number;
  useCachedResponse: boolean;
  revalidationHeaders: string[];
  isRevalidation: boolean;
  allowStore: boolean;
}

export interface CacheableResponse {
  statusCode: number;
  headers: Response["headers"];
  body: Buffer;
  responseUrl: string;
}

const defaultCacheableStatusCodes = new Set([
  200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501,
]);
const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

const isNotFoundError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const getHeaderValues = (
  headers: Response["headers"],
  name: string,
): string[] => {
  const normalizedName = name.toLowerCase();
  const value = Object.entries(headers).find(
    ([headerName]) => headerName === normalizedName,
  )?.[1];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const getHeaderValue = (
  headers: Response["headers"],
  name: string,
): string | undefined => {
  const values = getHeaderValues(headers, name);
  return values.length === 0 ? undefined : values.join(", ");
};

const normalizeRequestHeaders = (
  headers: string[],
): NormalizedRequestHeaders => {
  const normalized = new Map<string, string[]>();

  for (const header of headers) {
    const parsed = parseRequestHeaderLine(header);
    if (parsed === undefined) {
      continue;
    }

    const { name, value } = parsed;
    const values = normalized.get(name);
    if (values === undefined) {
      normalized.set(name, [value]);
    } else {
      values.push(value);
    }
  }

  return Object.fromEntries(normalized);
};

const parseCacheControl = (value: string | undefined): Map<string, string> => {
  const directives = new Map<string, string>();
  if (!value) {
    return directives;
  }

  for (const rawDirective of value.split(",")) {
    const directive = rawDirective.trim();
    if (!directive) {
      continue;
    }
    const equalsIndex = directive.indexOf("=");
    const rawName =
      equalsIndex < 0 ? directive : directive.slice(0, equalsIndex);
    const rawValue =
      equalsIndex < 0 ? "" : directive.slice(equalsIndex + 1).trim();
    const name = rawName.trim().toLowerCase();
    const normalizedValue =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
    directives.set(name, normalizedValue);
  }

  return directives;
};

const parseDeltaSeconds = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const getRequestHeaderValues = (
  requestHeaders: NormalizedRequestHeaders,
  name: string,
): string[] | undefined => {
  const normalizedName = name.toLowerCase();
  return Object.entries(requestHeaders).find(
    ([headerName]) => headerName === normalizedName,
  )?.[1];
};

const getRequestHeaderValue = (
  requestHeaders: NormalizedRequestHeaders,
  name: string,
): string | undefined => {
  const values = getRequestHeaderValues(requestHeaders, name);
  return values === undefined ? undefined : values.join(", ");
};

const stringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightValues = right.values();
  return left.every((value) => value === rightValues.next().value);
};

const varyRequestHeadersMatch = (
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

const getRequestCacheControl = (
  requestHeaders: NormalizedRequestHeaders,
): Map<string, string> =>
  parseCacheControl(getRequestHeaderValue(requestHeaders, "cache-control"));

const requestForcesRevalidation = (
  requestHeaders: NormalizedRequestHeaders,
): boolean => {
  const cacheControl = getRequestCacheControl(requestHeaders);
  if (cacheControl.has("no-cache")) {
    return true;
  }
  return (
    !getRequestHeaderValue(requestHeaders, "cache-control") &&
    getRequestHeaderValue(requestHeaders, "pragma")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "no-cache") === true
  );
};

const getVaryNamesFromHeaders = (headers: Response["headers"]): string[] =>
  [
    ...new Set(
      getHeaderValues(headers, "vary")
        .flatMap((value) => value.split(","))
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

const getVaryNames = (entry: CacheEntry): string[] =>
  getVaryNamesFromHeaders(entry.headers);

const requestMatchesEntry = (
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

const getFreshnessLifetime = (entry: CacheEntry): number => {
  const cacheControl = parseCacheControl(
    getHeaderValue(entry.headers, "cache-control"),
  );
  const maxAge = parseDeltaSeconds(cacheControl.get("max-age"));
  if (maxAge !== undefined) {
    return maxAge * 1_000;
  }

  const expires = getHeaderValue(entry.headers, "expires");
  if (expires === undefined) {
    return 0;
  }
  const expiresAt = Date.parse(expires);
  if (!Number.isFinite(expiresAt)) {
    return 0;
  }

  const dateHeader = getHeaderValue(entry.headers, "date");
  const responseDate =
    dateHeader === undefined ? Number.NaN : Date.parse(dateHeader);
  const freshnessBase = Number.isFinite(responseDate)
    ? responseDate
    : entry.responseTimestamp;
  return Math.max(0, expiresAt - freshnessBase);
};

const getCurrentAge = (entry: CacheEntry, now: number): number => {
  const dateHeader = getHeaderValue(entry.headers, "date");
  const responseDate =
    dateHeader === undefined ? Number.NaN : Date.parse(dateHeader);
  const apparentAge = Number.isFinite(responseDate)
    ? Math.max(0, entry.responseTimestamp - responseDate)
    : 0;
  const ageHeaderSeconds = parseDeltaSeconds(
    getHeaderValue(entry.headers, "age"),
  );
  const responseDelay = Math.max(
    0,
    entry.responseTimestamp - entry.requestTimestamp,
  );
  const correctedInitialAge = Math.max(
    apparentAge,
    (ageHeaderSeconds ?? 0) * 1_000 + responseDelay,
  );
  return correctedInitialAge + Math.max(0, now - entry.responseTimestamp);
};

const isFresh = (
  entry: CacheEntry,
  requestHeaders: NormalizedRequestHeaders,
  now: number,
): boolean => {
  const responseCacheControl = parseCacheControl(
    getHeaderValue(entry.headers, "cache-control"),
  );
  const requestCacheControl = getRequestCacheControl(requestHeaders);

  if (
    responseCacheControl.has("no-cache") ||
    requestForcesRevalidation(requestHeaders)
  ) {
    return false;
  }

  const currentAge = getCurrentAge(entry, now);
  let freshnessLifetime = getFreshnessLifetime(entry);
  const requestMaxAge = parseDeltaSeconds(requestCacheControl.get("max-age"));
  if (requestMaxAge !== undefined) {
    freshnessLifetime = Math.min(freshnessLifetime, requestMaxAge * 1_000);
  }

  const minFresh = parseDeltaSeconds(requestCacheControl.get("min-fresh"));
  return currentAge + (minFresh ?? 0) * 1_000 < freshnessLifetime;
};

const hasValidator = (entry: CacheEntry): boolean =>
  getHeaderValue(entry.headers, "etag") !== undefined ||
  getHeaderValue(entry.headers, "last-modified") !== undefined;

const readCacheEntries = (url: string): CacheEntry[] => {
  let serialized: string;
  try {
    // The URL is SHA-512 hashed by getCachePath, so it cannot control the path.
    serialized = readFileSync(getCachePath(url), "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw new Error(
      `Error reading from cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    const result = v.safeParse(cacheBucketSchema, parsed);
    if (result.success) {
      return result.output.entries;
    }
  } catch {
    // A partial/stale file should behave like a cache miss, not break requests.
  }

  rmSync(getCachePath(url), { force: true });
  return [];
};

const writeCacheEntries = (url: string, entries: CacheEntry[]): void => {
  const bucket: CacheBucket = { version: 1, entries };
  try {
    // fileCacheDirectory is derived only from the OS temp directory and uid.
    mkdirSync(fileCacheDirectory, { recursive: true, mode: 0o700 });
    // The URL is SHA-512 hashed by getCachePath, so it cannot control the path.
    writeFileSync(getCachePath(url), JSON.stringify(bucket), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    console.warn(
      `Error writing to cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const invalidateFileCache = (url: string): void => {
  try {
    rmSync(getCachePath(url), { force: true });
  } catch (error) {
    throw new Error(
      `Error invalidating cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const prepareFileCacheLookup = (
  method: string,
  url: string,
  headers: string[],
  cache: "file" | undefined,
  now = Date.now(),
): FileCacheLookup => {
  const requestHeaders = normalizeRequestHeaders(headers);
  const requestCacheControl = getRequestCacheControl(requestHeaders);
  const allowStore = !requestCacheControl.has("no-store");
  const base: FileCacheLookup = {
    requestHeaders,
    requestTimestamp: now,
    useCachedResponse: false,
    revalidationHeaders: headers,
    isRevalidation: false,
    allowStore,
  };

  if (cache !== "file" || method !== "GET" || !allowStore) {
    return base;
  }

  const entry = readCacheEntries(url).find((candidate) =>
    requestMatchesEntry(candidate, requestHeaders),
  );
  if (!entry) {
    return base;
  }

  if (
    hasRequestHeader(headers, "range") ||
    hasRequestHeader(headers, "if-none-match") ||
    hasRequestHeader(headers, "if-modified-since") ||
    requestForcesRevalidation(requestHeaders)
  ) {
    return { ...base, entry };
  }

  if (isFresh(entry, requestHeaders, now)) {
    return { ...base, entry, useCachedResponse: true };
  }

  if (!hasValidator(entry)) {
    return { ...base, entry };
  }

  const revalidationHeaders = [...headers];
  let isRevalidation = false;
  const etag = getHeaderValue(entry.headers, "etag");
  if (etag !== undefined) {
    setRequestHeader(revalidationHeaders, "If-None-Match", etag);
    isRevalidation = true;
  }
  const lastModified = getHeaderValue(entry.headers, "last-modified");
  if (lastModified !== undefined) {
    setRequestHeader(revalidationHeaders, "If-Modified-Since", lastModified);
    isRevalidation = true;
  }

  return {
    ...base,
    entry,
    revalidationHeaders,
    isRevalidation,
  };
};

const canStoreResponse = (response: CacheableResponse): boolean => {
  const cacheControl = parseCacheControl(
    getHeaderValue(response.headers, "cache-control"),
  );
  if (cacheControl.has("no-store")) {
    return false;
  }

  const varyNames = getVaryNamesFromHeaders(response.headers);
  if (varyNames.includes("*")) {
    return false;
  }

  if (defaultCacheableStatusCodes.has(response.statusCode)) {
    return true;
  }

  const hasExplicitFreshness =
    parseDeltaSeconds(cacheControl.get("max-age")) !== undefined ||
    getHeaderValue(response.headers, "expires") !== undefined;
  return response.statusCode !== 206 && hasExplicitFreshness;
};

export const storeFileCacheResponse = (
  url: string,
  requestHeaders: NormalizedRequestHeaders,
  requestTimestamp: number,
  responseTimestamp: number,
  response: CacheableResponse,
): void => {
  if (!canStoreResponse(response)) {
    return;
  }

  const entry: CacheEntry = {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body.toString("base64"),
    responseUrl: response.responseUrl,
    requestHeaders,
    requestTimestamp,
    responseTimestamp,
  };
  const varyNames = getVaryNames(entry);
  const existingEntries = readCacheEntries(url);
  const retainedEntries = existingEntries.filter((existing) => {
    const existingVaryNames = getVaryNames(existing);
    if (existingVaryNames.length !== varyNames.length) {
      return true;
    }
    if (!stringArraysEqual(existingVaryNames, varyNames)) {
      return true;
    }
    return !varyRequestHeadersMatch(
      varyNames,
      requestHeaders,
      existing.requestHeaders,
    );
  });

  writeCacheEntries(url, [entry, ...retainedEntries]);
};

const mergeRevalidationHeaders = (
  cached: Response["headers"],
  revalidated: Response["headers"],
): Response["headers"] => ({ ...cached, ...revalidated });

export const refreshFileCacheEntry = (
  url: string,
  lookup: FileCacheLookup,
  responseHeaders: Response["headers"],
  responseTimestamp: number,
): CacheableResponse | undefined => {
  const entry = lookup.entry;
  if (!entry || !lookup.isRevalidation) {
    return undefined;
  }

  const response: CacheableResponse = {
    statusCode: entry.statusCode,
    headers: mergeRevalidationHeaders(entry.headers, responseHeaders),
    body: Buffer.from(entry.body, "base64"),
    responseUrl: entry.responseUrl,
  };
  storeFileCacheResponse(
    url,
    lookup.requestHeaders,
    lookup.requestTimestamp,
    responseTimestamp,
    response,
  );
  return response;
};

export const getCachedResponse = (
  entry: NonNullable<FileCacheLookup["entry"]>,
): CacheableResponse => ({
  statusCode: entry.statusCode,
  headers: entry.headers,
  body: Buffer.from(entry.body, "base64"),
  responseUrl: entry.responseUrl,
});

export const getCachedRedirectUrl = (
  response: Pick<CacheableResponse, "statusCode" | "headers">,
): string | null => {
  if (!redirectStatusCodes.has(response.statusCode)) {
    return null;
  }
  return getHeaderValue(response.headers, "location") ?? null;
};
