import requestImpl from "#/index";

// TypeScript treats an ESM default import from .cjs as its module namespace.
// Select the callable declaration explicitly while preserving the runtime value.
const request: typeof requestImpl.default = requestImpl;

export const { CurlError, FormData, RequestError, ResponseError } = request;
export type CurlError = InstanceType<typeof CurlError>;
export type FormData = InstanceType<typeof FormData>;
export type RequestError = InstanceType<typeof RequestError>;
export type ResponseError = InstanceType<typeof ResponseError>;
export default request;
export type * from "#/index";
