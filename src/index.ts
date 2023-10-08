import request from './request';
import { CurlError } from './errors';

// ES Modules (ESM)
export type {
  HttpVerb,
  BufferEncoding,
  Options,
  Response,
  SetEasyOptionCallback
} from './types';
export default request;
export { CurlError };

// CommonJS (CJS)
module.exports = request;
module.exports.default = request;
module.exports.CurlError = CurlError;
