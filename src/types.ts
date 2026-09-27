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
 *
 * @group Request
 */
export type JsonLike = v.InferOutput<typeof jsonLikeSchema>;

/**
 * Uppercase HTTP method token used internally after request normalisation.
 *
 * @group Request
 */
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

/**
 * Options accepted by `request`.
 *
 * Payload precedence is `form`, then `json`, then `body` when more than one is
 * supplied.
 *
 * - `headers`: Node-style request headers. Header names and values are validated
 *   before transport.
 * - `qs`: Query values merged with any existing query string using bracket
 *   notation for nested objects and arrays. `undefined` values are omitted,
 *   `null` becomes an empty value, `Date` becomes ISO text, `Buffer` uses UTF-8,
 *   and cyclic objects throw `RangeError`.
 * - `json`: JSON-compatible value. A missing `Content-Type` is filled with
 *   `application/json`.
 * - `body`: Raw `string` or `Buffer` payload. No media type is invented.
 * - `form`: Synchronous `FormData` multipart payload.
 * - `timeout`: Per-network-attempt timeout in milliseconds. `0` or omission
 *   disables it. The budget resets for retries and redirect hops.
 * - `overallTimeout`: Monotonic deadline in milliseconds for the complete
 *   synchronous call, including retries, redirects, and retry delays. `0` or
 *   omission disables it.
 * - `socketTimeout`: Inactivity timeout in milliseconds. `0` or omission
 *   disables it.
 * - `followRedirects`: Follow redirects automatically. Defaults to `true`.
 * - `maxRedirects`: Maximum redirects to follow. Omitted, non-finite, or
 *   negative values mean no limit.
 * - `allowRedirectHeaders`: Case-insensitive allow-list of caller headers that
 *   may be forwarded to the next redirect hop. Payload headers are still
 *   removed when the redirect changes the method.
 * - `gzip`: Transparent gzip/deflate response decompression. Defaults to
 *   enabled; `false` preserves the encoded response.
 * - `cache`: Enable the HTTP-aware private cache using either `"file"` or
 *   `"memory"` storage.
 * - `cacheNamespace`: Private cache identity. Defaults to `process.cwd()`.
 * - `agent`: `sync-request` compatible boolean agent option, or a keep-alive
 *   Node `Agent` instance for additive connection-pool reuse.
 * - `retry`: Retry GET requests on transport failures and HTTP errors when
 *   `true`, or use a callback to decide per attempt.
 * - `retryDelay`: Delay between retries in milliseconds, or a callback that
 *   returns the delay. Defaults to 200 ms when retries are enabled.
 * - `maxRetries`: Maximum retry count. Defaults to 5 when retries are enabled.
 * - `proxy`: Explicit HTTP/HTTPS proxy origin URL. Ambient proxy environment
 *   variables are not used.
 * - `proxyAuth`: Basic proxy credentials. Requires `proxy` and overrides
 *   credentials embedded in the proxy URL.
 * - `rejectUnauthorized`: Verify the origin certificate chain and hostname.
 *   Defaults to `true`.
 * - `caFile`: PEM CA bundle path for origin TLS verification.
 * - `localAddress`: Source IPv4/IPv6 address. Hostnames are rejected.
 * - `localInterface`: Source interface name. Mutually exclusive with
 *   `localAddress`.
 * - `tcpKeepAlive`: Enable TCP keepalive, optionally with positive integer
 *   `idleSeconds` and `intervalSeconds` values.
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
 * - `statusCode`: HTTP response status code.
 * - `headers`: Node-style response headers with lowercase keys.
 * - `url`: Final effective URL after query handling and redirects.
 * - `body`: Mutable response body `Buffer`.
 * - `getBody`: Reads the response's current public body and status.
 * - `getJSON`: Parses the response's current public body as JSON.
 *
 * The helper methods intentionally observe later mutations to the public
 * response object rather than a hidden immutable snapshot.
 *
 * @group Response
 */
export type Response = ResponseData & {
  getBody: GetBody;
  getJSON: GetJSON;
};
