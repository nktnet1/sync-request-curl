import { IncomingHttpHeaders } from 'http';
import { CurlOption, Easy, HttpPostField } from 'node-libcurl';
import { JsonValue } from './json';

export type HttpVerb =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'CONNECT'
  | 'OPTIONS'
  | 'TRACE'
  | 'PATCH';

export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

export type SetEasyOptionCallback = (
  curl: Easy,
  curlOption: CurlOption
) => void;

export interface Options {
  headers?: IncomingHttpHeaders;
  qs?: { [key: string]: JsonValue };

  // You should only specify one of these.
  // They are processed in the order listed below.
  //
  // When no json, body or formdata is provided, Content-Length = 0
  // will be set in the headers.
  json?: JsonValue;
  body?: string | Buffer;
  formData?: HttpPostField[];

  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  insecure?: boolean;
  setEasyOptions?: SetEasyOptionCallback;
}

// Infer type `string` if encoding is specified, otherwise `string | Buffer
export type GetBody = {
  <Encoding extends BufferEncoding>(encoding: Encoding): string;
  (encoding?: undefined): Buffer;
};

export type GetJSON = <T extends JsonValue>(encoding?: BufferEncoding) => T;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  url: string;
  body: string | Buffer;
  getBody: GetBody;
  getJSON: GetJSON;
}
