import type * as v from "valibot";

export { FormData } from "#/form-data";

import type {
  bufferEncodingSchema,
  httpVerbInputSchema,
  jsonLikeSchema,
  optionsSchema,
  responseDataSchema,
  uppercaseHttpVerbSchema,
} from "#/validation";

export type { FormDataEntry } from "#/form-data";
export type {
  ProxyOptions,
  RetryDelayFunction,
  RetryFunction,
  RetryResponse,
} from "#/validation";

/**
 * Values accepted for JSON request bodies.
 *
 * This intentionally follows practical `JSON.stringify()` inputs rather than
 * only strict JSON syntax. `undefined` is allowed inside objects and arrays,
 * and objects with `toJSON()` (for example `Date`) are supported.
 *
 * @group Request
 */
export type JsonLike = v.InferOutput<typeof jsonLikeSchema>;

/** @internal */
export type UppercaseHttpVerb = v.InferOutput<typeof uppercaseHttpVerbSchema>;

/**
 * Any valid HTTP method token. Input is case-insensitive and is normalised to
 * uppercase before transport.
 *
 * @group Request
 */
export type HttpVerb = v.InferOutput<typeof httpVerbInputSchema>;

/**
 * Buffer encodings accepted by response body helpers.
 *
 * @group Response
 */
export type BufferEncoding = v.InferOutput<typeof bufferEncodingSchema>;

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
 * Unlike `GetBody`, this helper does not reject HTTP error status codes;
 * it only throws if the body cannot be parsed as JSON.
 *
 * @group Response
 */
export type GetJSON = <T = unknown>(encoding?: BufferEncoding) => T;

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
