import request from './request';
import { CurlError } from './errors';

export type { HttpVerb, BufferEncoding, Options, Response, SetEasyOptionCallback } from './types';
export default request;
export { CurlError };

module.exports = request;
module.exports.default = request;
module.exports.CurlError = CurlError;
