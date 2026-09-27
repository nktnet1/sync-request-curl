import type { Agent } from "node:http";
import type * as v from "valibot";
import type { FormData } from "#/form-data";

export { FormData } from "#/form-data";

import type {
  bufferEncodingSchema,
  httpVerbInputSchema,
  jsonLikeSchema,
  RetryDelayFunction,
  RetryFunction,
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

// Keep this as a named interface rather than a Valibot InferOutput alias.
// typedoc-plugin-valibot expands InferOutput aliases at reference sites; the
// schema-derived type equality assertion in tests/validation.test.ts guards drift.
/**
 * Options accepted by `request`.
 *
 * Payload precedence is `form`, then `json`, then `body` when more than one is
 * supplied.
 *
 * @group Request
 */
export interface Options {
  /** Explicit HTTP/HTTPS proxy origin URL. Ambient proxy variables are ignored. */
  proxy?: string;
  /** Basic proxy credentials. Requires `proxy` and overrides credentials in its URL. */
  proxyAuth?: {
    /** Proxy username. */
    username: string;
    /** Proxy password. */
    password: string;
  };
  /** Verify the origin certificate chain and hostname. Defaults to `true`. */
  rejectUnauthorized?: boolean;
  /** PEM CA bundle path for origin TLS verification. */
  caFile?: string;
  /** Source IPv4/IPv6 address. Hostnames are rejected. */
  localAddress?: string;
  /** Source interface name. Mutually exclusive with `localAddress`. */
  localInterface?: string;
  /** Enable TCP keepalive, optionally with idle and interval controls. */
  tcpKeepAlive?:
    | boolean
    | {
        /** Idle time in seconds before keepalive probes begin. */
        idleSeconds?: number;
        /** Interval in seconds between keepalive probes. */
        intervalSeconds?: number;
      };
  /** Private cache identity. Defaults to `process.cwd()`. */
  cacheNamespace?: string;
  /** Node-style request headers. */
  headers?: { [key: string]: string | string[] | undefined };
  /** Query values merged with any existing query string. */
  qs?: { [key: string]: unknown };
  /** JSON-compatible request body. Adds `application/json` when needed. */
  json?: JsonLike;
  /** Raw string or `Buffer` request body. */
  body?: string | Buffer;
  /** Synchronous multipart/form-data body. */
  form?: FormData;
  /** Per-network-attempt timeout in milliseconds. `0` disables it. */
  timeout?: number;
  /** Complete-operation deadline in milliseconds. `0` disables it. */
  overallTimeout?: number;
  /** Socket inactivity timeout in milliseconds. `0` disables it. */
  socketTimeout?: number;
  /** Follow redirects automatically. Defaults to `true`. */
  followRedirects?: boolean;
  /** Maximum redirects to follow. Negative or non-finite values mean no limit. */
  maxRedirects?: number;
  /** Caller headers allowed to be forwarded to redirect hops. */
  allowRedirectHeaders?: string[];
  /** Transparently decompress gzip/deflate responses. Defaults to enabled. */
  gzip?: boolean;
  /** Enable the private HTTP-aware cache in file or memory storage. */
  cache?: "file" | "memory";
  /** `sync-request` boolean agent option, or a keep-alive Node `Agent`. */
  agent?: boolean | Agent;
  /** Retry GET requests, or provide a callback to decide per attempt. */
  retry?: boolean | RetryFunction;
  /** Retry delay in milliseconds, or a callback returning the delay. */
  retryDelay?: number | RetryDelayFunction;
  /** Maximum retry count. Defaults to 5 when retries are enabled. */
  maxRetries?: number;
}

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
