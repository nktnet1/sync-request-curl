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

// JSON serializability is validated by jsonBodySchema immediately before use.
// This schema carries the public input type without eagerly invoking toJSON().
export const jsonLikeSchema = v.custom<JsonLikeValue>(() => true);

const optionsObjectSchema = v.object({
  headers: v.optional(incomingHttpHeadersSchema),
  qs: v.optional(v.record(v.string(), v.unknown())),
  json: v.optional(jsonLikeSchema),
  body: v.optional(v.union([v.string(), v.instance(Buffer)])),
  form: v.optional(v.instance(FormData)),
  timeout: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  socketTimeout: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  followRedirects: v.optional(v.boolean()),
  maxRedirects: v.optional(v.number()),
  allowRedirectHeaders: v.optional(v.array(v.string())),
  gzip: v.optional(v.boolean()),
  cache: v.optional(v.literal("file")),
  agent: v.optional(v.union([v.literal(false), v.instance(Agent)])),
  retry: v.optional(v.boolean()),
  retryDelay: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  maxRetries: v.optional(
    v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0)),
  ),
  debug: v.optional(v.boolean()),
});

export const optionsSchema = v.custom<
  v.InferOutput<typeof optionsObjectSchema>
>((input) => v.is(optionsObjectSchema, input), "Invalid request options");

export const uppercaseHttpVerbSchema = v.picklist([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "PATCH",
]);

export const uppercaseHttpVerbs = uppercaseHttpVerbSchema.options;

const lowercaseHttpVerbSchema = v.picklist([
  "get",
  "head",
  "post",
  "put",
  "delete",
  "connect",
  "options",
  "trace",
  "patch",
]);

export const httpVerbInputSchema = v.union([
  uppercaseHttpVerbSchema,
  lowercaseHttpVerbSchema,
]);

export const httpVerbSchema = v.pipe(
  v.string(),
  v.transform((method) => method.toUpperCase()),
  uppercaseHttpVerbSchema,
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
