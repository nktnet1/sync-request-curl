import { FormData as FormDataImpl } from "#/form-data";
import originalRequest from "#/request/index";

// Keep the CommonJS runtime as a callable module.exports value. This declaration-only
// export gives TypeScript the same named FormData surface as sync-request without
// making the bundler emit a named CommonJS export object.
export declare const FormData: typeof FormDataImpl;
export type { HttpVerb, Options, Response } from "#/types";

type Request = typeof originalRequest & {
  FormData: typeof FormDataImpl;
  default: Request;
};

const request = Object.assign(originalRequest, {
  FormData: FormDataImpl,
}) as Request;
request.default = request;

export default request;
