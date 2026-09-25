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
 */
export type JsonLike = v.InferOutput<typeof jsonLikeSchema>;

export type UppercaseHttpVerb = v.InferOutput<typeof uppercaseHttpVerbSchema>;

export type HttpVerb = v.InferOutput<typeof httpVerbInputSchema>;

export type BufferEncoding = v.InferOutput<typeof bufferEncodingSchema>;

export type Options = v.InferOutput<typeof optionsSchema>;

export type GetBody = {
  <Encoding extends BufferEncoding>(encoding: Encoding): string;
  (): Buffer;
};

export type GetJSON = <T = unknown>(encoding?: BufferEncoding) => T;

type ResponseData = v.InferOutput<typeof responseDataSchema>;

export type Response = ResponseData & {
  getBody: GetBody;
  getJSON: GetJSON;
};
