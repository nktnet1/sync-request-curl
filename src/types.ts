import { IncomingHttpHeaders } from 'http';
import { CurlOption, Easy, HttpPostField } from 'node-libcurl';

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

export type SetEasyOptionCallback = (curl: Easy, curlOption: CurlOption) => void;

export interface Options {
  /*
   * sync-request options
   */
  headers?: IncomingHttpHeaders;
  qs?: { [key: string]: any };
  json?: any;
  body?: string | Buffer;
  formData?: HttpPostField[];

  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;

  /*
   * node-libcurl options
   */
  insecure?: boolean;
  setEasyOptions?: SetEasyOptionCallback;
}

// Infer type `string` if encoding is specified, otherwise `string | Buffer
export type GetBody = <Encoding extends BufferEncoding | undefined>(arg?: Encoding)
  => Encoding extends BufferEncoding ? string : Buffer;

export type GetJSON = <T = any>(encoding?: BufferEncoding) => T;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  url: string;
  body: string | Buffer;
  getBody: GetBody;
  getJSON: GetJSON;
}
