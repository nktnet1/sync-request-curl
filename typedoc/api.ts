// Keep the request function as a direct reflection so the TypeDoc plugins can
// preserve references from its parameters to the public HttpVerb/Options types.
// Reflect constructors directly so TypeDoc retains their members when the ESM
// package root exposes aliases to the shared CommonJS implementation.

export { CurlError, RequestError, ResponseError } from "#/errors";
export { FormData } from "#/form-data";
export type * from "#/index-esm";
export { default as request } from "#/request/index";
