import { FormData } from "#/form-data";
import originalRequest from "#/request/index";

type Request = typeof originalRequest & {
  FormData: typeof FormData;
  default: Request;
};

const request = Object.assign(originalRequest, { FormData }) as Request;
request.default = request;

export default request;
