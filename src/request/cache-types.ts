import * as v from "valibot";
import { parseRequestHeaderLine } from "#/http/headers";
import type { CachedResponse, Options, Response } from "#/types/definition";
import { incomingHttpHeadersSchema } from "#/validation";

const cacheEntrySchema = v.object({
  cacheKey: v.string(),
  decompress: v.boolean(),
  statusCode: v.pipe(v.number(), v.integer()),
  headers: incomingHttpHeadersSchema,
  body: v.string(),
  responseUrl: v.string(),
  requestHeaders: v.record(v.string(), v.array(v.string())),
  requestTimestamp: v.pipe(v.number(), v.finite()),
  responseTimestamp: v.pipe(v.number(), v.finite()),
});

export const cacheBucketSchema = v.object({
  version: v.literal(2),
  entries: v.array(cacheEntrySchema),
});

export type CacheEntry = v.InferOutput<typeof cacheEntrySchema>;
export type CacheBucket = v.InferOutput<typeof cacheBucketSchema>;
export type NormalizedRequestHeaders = CacheEntry["requestHeaders"];
export type CacheMode = NonNullable<Options["cache"]>;

export interface CacheLookup {
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

// Responses exposed to callers must never share mutable headers with entries.
export const copyHeaders = (
  headers: Response["headers"],
): Response["headers"] =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]),
  );

export const copyRequestHeaders = (
  headers: NormalizedRequestHeaders,
): CachedResponse["requestHeaders"] =>
  Object.fromEntries(
    Object.entries(headers).map(([name, values]) => [
      name,
      values.length === 1 ? values[0] : [...values],
    ]),
  );

export const toCachedResponse = (entry: CacheEntry): CachedResponse => ({
  statusCode: entry.statusCode,
  headers: copyHeaders(entry.headers),
  body: Buffer.from(entry.body, "base64"),
  requestHeaders: copyRequestHeaders(entry.requestHeaders),
  requestTimestamp: entry.requestTimestamp,
});

export const getHeaderValues = (
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

export const getHeaderValue = (
  headers: Response["headers"],
  name: string,
): string | undefined => {
  const values = getHeaderValues(headers, name);
  return values.length === 0 ? undefined : values.join(", ");
};

export const normalizeRequestHeaders = (
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
