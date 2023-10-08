import { IncomingHttpHeaders } from 'http';
import { CurlOption, Easy } from 'node-libcurl';

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
export type GetBody = <encoding extends BufferEncoding | undefined>(arg?: encoding)
  => encoding extends BufferEncoding ? string : Buffer;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string | Buffer;
  getBody: GetBody;
  url: string;
}
