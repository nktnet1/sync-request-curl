import type { IncomingHttpHeaders } from "http";

export interface CurlOption {
  readonly HTTPHEADER: 1;
  readonly PROXY: 2;
  readonly PROXYUSERPWD: 3;
  readonly USERAGENT: 4;
  readonly REFERER: 5;
  readonly CAINFO: 6;
  readonly INTERFACE: 7;
  readonly DNS_SERVERS: 8;
  readonly TCP_KEEPALIVE: 9;
}

export type CurlOptionValue = CurlOption[keyof CurlOption];
export type CurlOptionInput = string | string[] | number | boolean;

export interface Easy {
  readonly isOpen: boolean;
  // eslint-disable-next-line no-unused-vars -- Interface parameter names document the compatibility API.
  setOpt(option: CurlOptionValue, value: CurlOptionInput): void;
  close(): void;
}

// biome-ignore lint/suspicious/noExplicitAny: to match sync-request input type
export type CustomJsonType = any;

export type HttpVerb =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE"
  | "PATCH";

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

export type HttpPostField =
  | {
      name: string;
      contents: string;
    }
  | {
      name: string;
      file: string;
      type?: string;
      filename?: string;
    };

export type SetEasyOptionCallback = (
  curl: Easy,
  curlOption: CurlOption,
) => void;

export interface Options {
  headers?: IncomingHttpHeaders;
  qs?: { [key: string]: CustomJsonType };

  // You should only specify one of these.
  // They are processed in the order listed below.
  //
  // When no json, body or formdata is provided, Content-Length = 0
  // will be set in the headers.
  json?: CustomJsonType;
  body?: string | Buffer;
  formData?: HttpPostField[];

  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;

  insecure?: boolean;
  debug?: boolean;
  setEasyOptions?: SetEasyOptionCallback;
}

// Infer type `string` if encoding is specified, otherwise `Buffer`.
export type GetBody = {
  <Encoding extends BufferEncoding>(encoding: Encoding): string;
  (encoding?: undefined): Buffer;
};

export type GetJSON = <T = CustomJsonType>(encoding?: BufferEncoding) => T;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  url: string;
  body: string | Buffer;
  getBody: GetBody;
  getJSON: GetJSON;
}
