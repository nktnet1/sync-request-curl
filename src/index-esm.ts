import requestImpl from "#/index";

// TypeScript treats an ESM default import from .cjs as its module namespace.
// Select the callable declaration explicitly while preserving the runtime value.
const request: typeof requestImpl.default = requestImpl;

const { CurlError, FormData, RequestError, ResponseError } = request;
type CurlError = InstanceType<typeof CurlError>;
type FormData = InstanceType<typeof FormData>;
type RequestError = InstanceType<typeof RequestError>;
type ResponseError = InstanceType<typeof ResponseError>;

export { CurlError, FormData, RequestError, ResponseError };
export default request;
export type * from "#/types/public";
