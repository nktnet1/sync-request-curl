import { IncomingHttpHeaders } from 'http';

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

export interface Options {
  headers?: IncomingHttpHeaders;
  qs?: {
    [key: string]: any;
  };
  json?: any;
  timeout?: number;
  body?: string | Buffer | NodeJS.ReadableStream;
  followRedirects?: boolean;
  maxRedirects?: number;
}

export type GetBody = <B extends BufferEncoding | undefined>(arg?: B) => B extends BufferEncoding ? string : Buffer;

export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string | Buffer;
  getBody: GetBody;
}
