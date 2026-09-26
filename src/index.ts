import { FormData } from "#/form-data";
import originalRequest from "#/request/index";

const request = Object.assign(originalRequest, { FormData });

export default request;
