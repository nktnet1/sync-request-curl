import type { IncomingHttpHeaders } from "node:http";
import type { FormData } from "#/form-data";

// biome-ignore lint/suspicious/noExplicitAny: matches sync-request's JSON input/output type
export type CustomJsonType = any;

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
  qs?: Record<string, CustomJsonType>;

  // Request payloads are mutually exclusive and resolved in this order.
  json?: CustomJsonType;
  body?: string | Buffer;
  form?: FormData;

  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  allowRedirectHeaders?: string[];

  /** Include request inputs in transport error messages. */
  debug?: boolean;
}

export type GetBody = {
  <Encoding extends BufferEncoding>(encoding: Encoding): string;
  (encoding?: undefined): Buffer;
};

export type GetJSON = <T = CustomJsonType>(encoding?: BufferEncoding) => T;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  url: string;
  body: Buffer;
  getBody: GetBody;
  getJSON: GetJSON;
}
