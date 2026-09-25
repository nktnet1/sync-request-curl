import type { IncomingHttpHeaders } from "node:http";
import { FormData } from "#/form-data";

export type { FormDataEntry } from "#/form-data";
export { FormData };

type JsonPrimitive = string | number | boolean | null;

type NestedJsonLike = JsonLike | undefined | { toJSON(): NestedJsonLike };

/**
 * Values accepted for JSON request bodies.
 *
 * This intentionally follows practical `JSON.stringify()` inputs rather than
 * only strict JSON syntax. `undefined` is allowed inside objects and arrays,
 * and objects with `toJSON()` (for example `Date`) are supported.
 */
export type JsonLike =
  | JsonPrimitive
  | readonly NestedJsonLike[]
  | { [key: string]: NestedJsonLike }
  | { toJSON(): JsonLike };

export type UppercaseHttpVerb =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE"
  | "PATCH";

export type HttpVerb = UppercaseHttpVerb | Lowercase<UppercaseHttpVerb>;

export type BufferEncoding =
  | "ascii"
  | "utf8"
  | "utf-8"
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "base64"
  | "base64url"
  | "latin1"
  | "binary"
  | "hex";

export interface Options {
  headers?: IncomingHttpHeaders;
  qs?: Record<string, unknown>;

  // Request payloads are mutually exclusive and resolved in this order.
  json?: JsonLike;
  body?: string | Buffer;
  form?: FormData;

  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  allowRedirectHeaders?: string[];
  gzip?: boolean;
  retry?: boolean;
  retryDelay?: number;
  maxRetries?: number;

  /** Include request inputs in transport error messages. */
  debug?: boolean;
}

export type GetBody = {
  <Encoding extends BufferEncoding>(encoding: Encoding): string;
  (): Buffer;
};

export type GetJSON = <T = unknown>(encoding?: BufferEncoding) => T;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  url: string;
  body: Buffer;
  getBody: GetBody;
  getJSON: GetJSON;
}
