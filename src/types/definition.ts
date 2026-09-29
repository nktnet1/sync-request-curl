import type * as v from "valibot";

import type {
  BufferEncoding,
  optionsSchema,
  responseDataSchema,
  uppercaseHttpVerbSchema,
} from "#/validation";

export type { FormDataEntry } from "#/form-data";
export type {
  BufferEncoding,
  CacheCanCacheFunction,
  CachedResponse,
  CacheIsExpiredFunction,
  CacheIsMatchFunction,
  CachePolicyResponse,
  JsonLike,
  JsonPrimitive,
  NestedJsonLike,
  ProxyOptions,
  RetryDelayFunction,
  RetryFunction,
  RetryResponse,
} from "#/validation";

/** @internal */
export type UppercaseHttpVerb = v.InferOutput<typeof uppercaseHttpVerbSchema>;

/**
 * Supported HTTP methods. Input is case-insensitive and is normalised to
 * uppercase before transport.
 *
 * @group Request
 */
export type HttpVerb =
  | "GET"
  | "get"
  | "HEAD"
  | "head"
  | "POST"
  | "post"
  | "PUT"
  | "put"
  | "DELETE"
  | "delete"
  | "CONNECT"
  | "connect"
  | "OPTIONS"
  | "options"
  | "TRACE"
  | "trace"
  | "PATCH"
  | "patch"
  | "PROPFIND"
  | "propfind";

// Keep the public shape schema-derived. The TypeDoc integration restores the
// request parameter to this named reflection after typedoc-plugin-valibot runs.
/**
 * Options accepted by `request`.
 *
 * Payload precedence is `form`, then `json`, then `body` when more than one is
 * supplied.
 *
 * @group Request
 */
export type Options = v.InferOutput<typeof optionsSchema>;

/**
 * Read the current response body.
 *
 * Calling without an encoding returns the `Buffer`. Passing an encoding returns
 * a string. A response with `statusCode >= 300` throws `ResponseError`.
 *
 * @group Response
 */
export type GetBody = {
  <Encoding extends BufferEncoding>(encoding: Encoding): string;
  (): Buffer;
};

/**
 * Parse the current response body as JSON.
 *
 * Unlike `GetBody`, this helper does not reject HTTP error status codes.
 * It only throws if the body cannot be parsed as JSON.
 * Defaults to `any` for v4 compatibility. Pass an explicit type argument to
 * describe the expected result; this does not perform runtime validation.
 *
 * @group Response
 */
// biome-ignore lint/suspicious/noExplicitAny: preserve the v4 getJSON default
export type GetJSON = <T = any>(encoding?: BufferEncoding) => T;

type ResponseData = v.InferOutput<typeof responseDataSchema>;

/**
 * Buffered synchronous response returned by `request`.
 *
 * Helper methods observe later mutations to the public response object rather
 * than a hidden immutable snapshot.
 *
 * @group Response
 * @interface
 */
export type Response = ResponseData & {
  /** Read the response body and throw `ResponseError` for HTTP status >= 300. */
  getBody: GetBody;
  /** Parse the response body as JSON without applying HTTP status handling. */
  getJSON: GetJSON;
};
