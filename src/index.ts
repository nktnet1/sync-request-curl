import request from './request';

module.exports = request;
module.exports.default = request;

export type { HttpVerb, BufferEncoding, Options, Response } from './types';
export default request;
