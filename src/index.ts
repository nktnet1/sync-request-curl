import request from './request';
export { CurlError } from './errors';

export type {
  HttpVerb,
  BufferEncoding,
  Options,
  Response,
  SetEasyOptionCallback
} from './types';

export type { HttpPostField } from 'node-libcurl';

export default request;
