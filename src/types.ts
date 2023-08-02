import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';

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
  timeout?: number;
  qs?: {
    [key: string]: any;
  };
  json?: any;
  body?: string | Buffer | NodeJS.ReadableStream;
}

export type GetBody = <B extends BufferEncoding | undefined>(arg?: B) => B extends BufferEncoding ? string : Buffer;
export interface Response {

  statusCode: number;
  headers: OutgoingHttpHeaders;
  body: string | Buffer;
  getBody: GetBody;
}
