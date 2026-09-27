import { Agent } from "node:http";
import { URL } from "node:url";
import * as v from "valibot";
import { FormData } from "#/form-data";

type JsonPrimitive = string | number | boolean | null;
type NestedJsonLike = JsonLikeValue | undefined | { toJSON(): NestedJsonLike };
type JsonLikeValue =
  | JsonPrimitive
  | readonly NestedJsonLike[]
  | { [key: string]: NestedJsonLike }
  | { toJSON(): JsonLikeValue };

const headerValueSchema = v.union([
  v.string(),
  v.array(v.string()),
  v.undefined(),
]);

const incomingHttpHeadersObjectSchema = v.record(v.string(), headerValueSchema);

export const incomingHttpHeadersSchema = v.custom<
  v.InferOutput<typeof incomingHttpHeadersObjectSchema>
>(
  (input) => v.is(incomingHttpHeadersObjectSchema, input),
  "Invalid HTTP headers",
);

/**
 * Response shape passed to retry policy callbacks.
 *
 * `getBody()` follows the same status handling as a normal response. Retry
 * callbacks receive this buffered response before the next attempt begins.
 *
 * @group Request
 */
export interface RetryResponse {
  statusCode: number;
  headers: v.InferOutput<typeof incomingHttpHeadersSchema>;
  url: string;
  body: Buffer;
  getBody(encoding: BufferEncoding): string;
  getBody(): Buffer;
}

/**
 * Decide whether a GET request should be retried after an error or response.
 *
 * `attemptNumber` starts at 1 for the first completed attempt.
 *
 * @group Request
 */
export type RetryFunction = (
  error: Error | null,
  response: RetryResponse | undefined,
  attemptNumber: number,
) => boolean;

/**
 * Return the delay in milliseconds before the next retry.
 *
 * `attemptNumber` starts at 1 for the first completed attempt.
 *
 * @group Request
 */
export type RetryDelayFunction = (
  error: Error | null,
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

// JSON serializability is validated by jsonBodySchema immediately before use.
// This schema carries the public input type without eagerly invoking toJSON().
export const jsonLikeSchema = v.custom<JsonLikeValue>(() => true);

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

const optionsObjectSchema = v.object({
  proxy: v.optional(nativeStringSchema),
  proxyAuth: v.optional(
    v.object({
      username: v.pipe(
        v.string(),
        v.check((value) => !value.includes("\0")),
      ),
      password: v.pipe(
        v.string(),
        v.check((value) => !value.includes("\0")),
      ),
    }),
  ),
  rejectUnauthorized: v.optional(v.boolean()),
  caFile: v.optional(nativeStringSchema),
  localAddress: v.optional(nativeStringSchema),
  localInterface: v.optional(nativeStringSchema),
  tcpKeepAlive: v.optional(
    v.union([
      v.boolean(),
      v.object({
        idleSeconds: v.optional(keepAliveSecondsSchema),
        intervalSeconds: v.optional(keepAliveSecondsSchema),
      }),
    ]),
  ),
  cacheNamespace: v.optional(v.string()),
  headers: v.optional(incomingHttpHeadersSchema),
  qs: v.optional(v.record(v.string(), v.unknown())),
  json: v.optional(jsonLikeSchema),
  body: v.optional(v.union([v.string(), v.instance(Buffer)])),
  form: v.optional(v.instance(FormData)),
  timeout: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
  overallTimeout: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
  socketTimeout: v.optional(
    v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
  followRedirects: v.optional(v.boolean()),
  maxRedirects: v.optional(v.number()),
  allowRedirectHeaders: v.optional(v.array(v.string())),
  gzip: v.optional(v.boolean()),
  cache: v.optional(v.picklist(["file", "memory"])),
  agent: v.optional(v.union([v.boolean(), v.instance(Agent)])),
  retry: v.optional(v.union([v.boolean(), retryFunctionSchema])),
  retryDelay: v.optional(
    v.union([
      v.pipe(v.number(), v.finite(), v.minValue(0)),
      retryDelayFunctionSchema,
    ]),
  ),
  maxRetries: v.optional(
    v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0)),
  ),
});

export const optionsSchema = v.custom<
  v.InferOutput<typeof optionsObjectSchema>
>(
  (input) => !Array.isArray(input) && v.is(optionsObjectSchema, input),
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
  "ucs2",
  "ucs-2",
  "base64",
  "base64url",
  "latin1",
  "binary",
  "hex",
]);

export const responseDataSchema = v.object({
  statusCode: v.number(),
  headers: incomingHttpHeadersSchema,
  url: v.string(),
  body: v.instance(Buffer),
});

export const requestUrlSchema = v.pipe(
  v.union([v.string(), v.instance(URL)]),
  v.transform((url) => (typeof url === "string" ? url : url.href)),
);
