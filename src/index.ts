import {
  CurlError as CurlErrorImpl,
  RequestError as RequestErrorImpl,
  ResponseError as ResponseErrorImpl,
} from "#/errors";
import { FormData as FormDataImpl } from "#/form-data";
import originalRequest from "#/request/index";

// Keep the CommonJS runtime as a callable module.exports value. These
// declaration-only exports describe properties attached to that function
// without making the bundler emit a named CommonJS export object.
export declare const FormData: typeof FormDataImpl;
export declare const CurlError: typeof CurlErrorImpl;
export declare const RequestError: typeof RequestErrorImpl;
export declare const ResponseError: typeof ResponseErrorImpl;

export type { RequestErrorCode } from "#/errors";
export type {
  BufferEncoding,
  FormDataEntry,
  GetBody,
  GetJSON,
  HttpVerb,
  JsonLike,
  JsonPrimitive,
  NestedJsonLike,
  Options,
  ProxyOptions,
  Response,
  RetryDelayFunction,
  RetryFunction,
  RetryResponse,
} from "#/types";

type Request = typeof originalRequest & {
  FormData: typeof FormDataImpl;
  CurlError: typeof CurlErrorImpl;
  RequestError: typeof RequestErrorImpl;
  ResponseError: typeof ResponseErrorImpl;
  default: Request;
};

const request = Object.assign(originalRequest, {
  FormData: FormDataImpl,
  CurlError: CurlErrorImpl,
  RequestError: RequestErrorImpl,
  ResponseError: ResponseErrorImpl,
}) as Request;
request.default = request;

export default request;
