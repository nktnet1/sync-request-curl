import { Agent, type IncomingHttpHeaders } from "node:http";
import { URL } from "node:url";
import * as v from "valibot";
import type { CurlError } from "#/errors";
import { FormData } from "#/form-data";

/** Primitive JSON values accepted in request bodies.
 *
 * @group Request
 */
export type JsonPrimitive = string | number | boolean | null;

/** Values accepted when nested inside JSON request bodies.
 *
 * @group Request
 */
export type NestedJsonLike =
  | JsonLike
  | undefined
  | { toJSON: () => NestedJsonLike };

/**
 * Values accepted for JSON request bodies.
 *
 * This intentionally follows practical `JSON.stringify()` inputs rather than
 * only strict JSON syntax. `undefined` is allowed inside objects and arrays,
 * and objects with `toJSON()` (for example `Date`) are supported.
 *
 * @group Request
 */
export type JsonLike =
  | JsonPrimitive
  | readonly NestedJsonLike[]
  | { [key: string]: NestedJsonLike }
  | { toJSON: () => JsonLike };

/**
 * Buffer encodings accepted by response body helpers.
 *
 * @group Response
 */
export type BufferEncoding =
  | "base64"
  | "ascii"
  | "utf8"
  | "utf-8"
  | "utf16le"
  | "utf-16le"
  | "ucs2"
  | "ucs-2"
  | "base64url"
  | "latin1"
  | "binary"
  | "hex";

const headerValueSchema = v.union([
  v.string(),
  v.array(v.string()),
  v.undefined(),
]);

const incomingHttpHeadersObjectSchema = v.record(v.string(), headerValueSchema);

export const incomingHttpHeadersSchema = v.custom<IncomingHttpHeaders>(
  (input) => v.is(incomingHttpHeadersObjectSchema, input),
  "Invalid HTTP headers",
);

/**
 * An explicit HTTP/HTTPS proxy and optional Basic credentials.
 *
 * @group Request
 */
export interface ProxyOptions {
  /** HTTP/HTTPS proxy origin URL. May contain URL-encoded credentials. */
  url: string;
  /** Overrides both URL credentials. An omitted password becomes an empty string. */
  username?: string;
  /** Proxy password. Requires an explicit username. Defaults to an empty string. */
  password?: string;
}

/**
 * Response shape passed to retry policy callbacks.
 *
 * `getBody()` follows the same status handling as a normal response. Retry
 * callbacks receive this buffered response before the next attempt begins.
 *
 * @group Request
 */
export interface RetryResponse {
  /** HTTP response status code. */
  statusCode: number;
  /** Node-style response headers with lowercase keys. */
  headers: IncomingHttpHeaders;
  /** Final effective URL for the completed attempt. */
  url: string;
  /** Buffered response body. */
  body: Buffer;
  /** Read the response body as a string using the requested encoding. */
  getBody(encoding: BufferEncoding): string;
  /** Read the response body as a `Buffer`. */
  getBody(): Buffer;
}

/**
 * Buffered cached response passed to cache policy callbacks.
 *
 * The body, headers, and request headers are defensive copies. Mutating them
 * does not modify the stored cache entry.
 *
 * @group Request
 */
export interface CachedResponse {
  /** Cached HTTP response status code. */
  statusCode: number;
  /** Cached Node-style response headers with lowercase keys. */
  headers: IncomingHttpHeaders;
  /** Buffered cached response body. */
  body: Buffer;
  /** Request headers stored with this cache variant. */
  requestHeaders: IncomingHttpHeaders;
  /** Timestamp when the cached request started, in Unix milliseconds. */
  requestTimestamp: number;
}

/**
 * Buffered origin response passed to `canCache`.
 *
 * This is the normal public response shape for the completed GET request.
 *
 * @group Request
 */
export interface CachePolicyResponse extends RetryResponse {
  /** Parse the buffered response body as JSON. */
  // biome-ignore lint/suspicious/noExplicitAny: match Response#getJSON default
  getJSON<T = any>(encoding?: BufferEncoding): T;
}

/**
 * Override whether a stored cache variant matches the outgoing request.
 *
 * `defaultValue` is the built-in `Vary` comparison result.
 *
 * @group Request
 */
export type CacheIsMatchFunction = (
  requestHeaders: IncomingHttpHeaders,
  cachedResponse: CachedResponse,
  defaultValue: boolean,
) => boolean;

/**
 * Override whether a matched cached response is expired.
 *
 * `defaultValue` is the result of the built-in freshness calculation.
 *
 * @group Request
 */
export type CacheIsExpiredFunction = (
  cachedResponse: CachedResponse,
  defaultValue: boolean,
) => boolean;

/**
 * Override whether a completed origin response may be stored in the cache.
 *
 * `defaultValue` is the built-in response cacheability result. Request-side
 * `Cache-Control: no-store` still disables storage before this callback runs.
 *
 * @group Request
 */
export type CacheCanCacheFunction = (
  response: CachePolicyResponse,
  defaultValue: boolean,
) => boolean;

/**
 * Decide whether a GET request should be retried after an error or response.
 *
 * `attemptNumber` starts at 1 for the first completed attempt. Transport
 * failures are passed as `CurlError` instances whose `code` is the numeric
 * libcurl error code.
 *
 * @group Request
 */
export type RetryFunction = (
  error: CurlError | null,
  response: RetryResponse | undefined,
  attemptNumber: number,
) => boolean;

/**
 * Return the delay in milliseconds before the next retry.
 *
 * `attemptNumber` starts at 1 for the first completed attempt. Transport
 * failures are passed as `CurlError` instances whose `code` is the numeric
 * libcurl error code.
 *
 * @group Request
 */
export type RetryDelayFunction = (
  error: CurlError | null,
  response: RetryResponse | undefined,
  attemptNumber: number,
) => number;

const retryFunctionSchema = v.custom<RetryFunction>(
  (input) => typeof input === "function",
  "Invalid retry function",
);

const retryDelayFunctionSchema = v.custom<RetryDelayFunction>(
  (input) => typeof input === "function",
  "Invalid retry delay function",
);

const cacheIsMatchFunctionSchema = v.custom<CacheIsMatchFunction>(
  (input) => typeof input === "function",
  "Invalid cache isMatch function",
);

const cacheIsExpiredFunctionSchema = v.custom<CacheIsExpiredFunction>(
  (input) => typeof input === "function",
  "Invalid cache isExpired function",
);

const cacheCanCacheFunctionSchema = v.custom<CacheCanCacheFunction>(
  (input) => typeof input === "function",
  "Invalid cache canCache function",
);

// JSON serializability is validated by jsonBodySchema immediately before use.
// This schema carries the public input type without eagerly invoking toJSON().
export const jsonLikeSchema = v.custom<JsonLike>(() => true);

const nativeStringSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((value) => !value.includes("\0")),
);
const keepAliveSecondsSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(2_147_483_647),
);

const proxyCredentialSchema = v.pipe(
  v.string(),
  v.check((value) => !value.includes("\0")),
);

const proxyObjectSchema = v.object({
  url: nativeStringSchema,
  username: v.optional(proxyCredentialSchema),
  password: v.optional(proxyCredentialSchema),
});

export const proxySchema = v.custom<ProxyOptions>(
  (input) =>
    v.is(proxyObjectSchema, input) &&
    (input.password === undefined || input.username !== undefined),
  "Invalid proxy configuration: password requires username",
);

const optionsObjectSchema = v.object({
  /**
   * Explicit HTTP/HTTPS proxy origin URL. Ambient proxy variables are ignored.
   * Defaults to no proxy.
   */
  proxy: v.optional(proxySchema),
  /** Verify the origin certificate chain and hostname. Defaults to `true`. */
  rejectUnauthorized: v.optional(v.boolean()),
  /** PEM CA bundle path for origin TLS verification. */
  caFile: v.optional(nativeStringSchema),
  /** Source IPv4/IPv6 address. Hostnames are rejected. */
  localAddress: v.optional(nativeStringSchema),
  /** Source interface name. Mutually exclusive with `localAddress`. */
  localInterface: v.optional(nativeStringSchema),
  /**
   * Enable TCP keepalive, optionally with idle and interval controls. Defaults
   * to `false`.
   */
  tcpKeepAlive: v.optional(
    v.union([
      v.boolean(),
      v.object({
        /** Idle time in seconds before keepalive probes begin. */
        idleSeconds: v.optional(keepAliveSecondsSchema),
        /** Interval in seconds between keepalive probes. */
        intervalSeconds: v.optional(keepAliveSecondsSchema),
      }),
    ]),
  ),
  /** Private cache identity. Defaults to `process.cwd()`. */
  cacheNamespace: v.optional(v.string()),
  /** Node-style request headers. */
  headers: v.optional(incomingHttpHeadersSchema),
  /** Query values merged with any existing query string. */
  qs: v.optional(v.record(v.string(), v.unknown())),
  /** JSON-compatible request body. Adds `application/json` when needed. */
  json: v.optional(jsonLikeSchema),
  /** Raw string or `Buffer` request body. */
  body: v.optional(v.union([v.string(), v.instance(Buffer)])),
  /** Synchronous multipart/form-data body. */
  form: v.optional(v.instance(FormData)),
  /**
   * Maximum time to wait for response headers in milliseconds. Defaults to `0`,
   * which disables it.
   */
  timeout: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
  /**
   * Complete-operation deadline in milliseconds. Defaults to `0`, which
   * disables it.
   */
  overallTimeout: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
  /**
   * Socket inactivity timeout in milliseconds. Defaults to `0`, which disables
   * it.
   */
  socketTimeout: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
  /** Follow redirects automatically. Defaults to `true`. */
  followRedirects: v.optional(v.boolean()),
  /**
   * Maximum redirects to follow. Defaults to no limit. Negative values and
   * infinities also mean no limit; `NaN` is invalid.
   */
  maxRedirects: v.optional(v.number()),
  /**
   * Caller headers allowed to be forwarded to redirect hops. Defaults to none.
   */
  allowRedirectHeaders: v.optional(v.array(v.string())),
  /** Transparently decompress gzip/deflate responses. Defaults to `true`. */
  gzip: v.optional(v.boolean()),
  /**
   * Enable the private HTTP-aware cache in file or memory storage. Defaults to
   * disabled.
   */
  cache: v.optional(v.picklist(["file", "memory"])),
  /**
   * Override whether a stored cache variant matches the outgoing request. When
   * caching is enabled, defaults to the built-in `Vary` comparison.
   */
  isMatch: v.optional(cacheIsMatchFunctionSchema),
  /**
   * Override whether a matched cached response is expired. When caching is
   * enabled, defaults to the built-in freshness calculation.
   */
  isExpired: v.optional(cacheIsExpiredFunctionSchema),
  /**
   * Override whether a completed origin response may be stored. When caching is
   * enabled, defaults to the built-in response cacheability rules.
   */
  canCache: v.optional(cacheCanCacheFunctionSchema),
  /**
   * `sync-request` boolean agent option, or a keep-alive Node `Agent` for
   * connection reuse. Defaults to the standard connection behaviour without a
   * dedicated persistent pool.
   */
  agent: v.optional(v.union([v.boolean(), v.instance(Agent)])),
  /**
   * Retry GET requests, or provide a callback to decide per attempt. Defaults
   * to disabled.
   */
  retry: v.optional(v.union([v.boolean(), retryFunctionSchema])),
  /**
   * Retry delay in milliseconds, or a callback returning the delay. Defaults to
   * 200 milliseconds when retries are enabled.
   */
  retryDelay: v.optional(
    v.union([
      v.pipe(v.number(), v.finite(), v.minValue(0)),
      retryDelayFunctionSchema,
    ]),
  ),
  /** Maximum retry count. Defaults to 5 when retries are enabled. */
  maxRetries: v.optional(
    v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0)),
  ),
});

export const optionsSchema = v.custom<
  v.InferOutput<typeof optionsObjectSchema>
>(
  (input) =>
    !Array.isArray(input) &&
    v.is(optionsObjectSchema, input) &&
    !("proxyAuth" in input),
  "Invalid request options",
);

const httpMethodTokenSchema = v.pipe(
  v.string(),
  v.regex(/^[!#$%&'*+.^`|~\w-]+$/, "Expected a valid HTTP method token"),
);

export const uppercaseHttpVerbSchema = v.pipe(
  httpMethodTokenSchema,
  v.check(
    (method) => method === method.toUpperCase(),
    "Expected an uppercase HTTP method",
  ),
);

export const httpVerbInputSchema = httpMethodTokenSchema;

export const httpVerbSchema = v.pipe(
  httpMethodTokenSchema,
  v.transform((method) => method.toUpperCase()),
);

export const bufferEncodingSchema = v.picklist([
  "ascii",
  "utf8",
  "utf-8",
  "utf16le",
  "utf-16le",
  "ucs2",
  "ucs-2",
  "base64",
  "base64url",
  "latin1",
  "binary",
  "hex",
] as const satisfies readonly BufferEncoding[]);

export const responseDataSchema = v.object({
  /** HTTP response status code. */
  statusCode: v.number(),
  /** Node-style response headers with lowercase keys. */
  headers: incomingHttpHeadersSchema,
  /** Final effective URL after query handling and redirects. */
  url: v.string(),
  /** Mutable buffered response body. */
  body: v.instance(Buffer),
});

export const requestUrlSchema = v.pipe(
  v.union([v.string(), v.instance(URL)]),
  v.transform((url) => (typeof url === "string" ? url : url.href)),
);
