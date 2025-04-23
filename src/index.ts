import request from './request';
import { CurlError } from './errors';

export type {
  HttpVerb,
  BufferEncoding,
  Options,
  Response,
  SetEasyOptionCallback,
} from './@types';

export type {
  JsonArray,
  JsonObject,
  JsonPrimitiveOptional,
  JsonValue,
} from './@types/json';

export type { HttpPostField } from 'node-libcurl';

// ES Modules (ESM)
export default request;
export { CurlError };

// CommonJS (CJS)
module.exports = request;
module.exports.default = request;
module.exports.CurlError = CurlError;
