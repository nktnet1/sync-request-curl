import { FormData } from "#/form-data";
import request from "#/request/index";

export type { FormDataEntry } from "#/form-data";
export { FormData } from "#/form-data";
export type {
  BufferEncoding,
  HttpVerb,
  Options,
  Response,
  UppercaseHttpVerb,
} from "#/types";

const requestWithFormData = Object.assign(request, { FormData });

export default requestWithFormData;
