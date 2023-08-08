import request from './request';

module.exports = request;
module.exports.default = request;

export type { HttpVerb, BufferEncoding, Options, Response, SetEasyOptionCallback } from './types';
export default request;
