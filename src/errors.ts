import type { IncomingHttpHeaders } from "node:http";
import type { HttpVerb, Options } from "#/types";

export type RequestErrorCode =
  | "ERR_INVALID_URL"
  | "ENOTFOUND"
  | "ETIMEDOUT"
  | "ERR_TOO_MANY_REDIRECTS"
  | "ERR_REQUEST_FAILED";

export class RequestError extends Error {
  readonly code: RequestErrorCode;

  constructor(code: RequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RequestError";
    this.code = code;
  }
}

export class ResponseError extends Error {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;

  constructor(statusCode: number, headers: IncomingHttpHeaders, body: Buffer) {
    super(`Server responded with status code ${statusCode}`);
    this.name = "ResponseError";
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = body;
  }
}

interface RequestInputs {
  method: HttpVerb;
  url: string;
  options: Options;
}

const transportErrorCode = (code: number): RequestErrorCode => {
  switch (code) {
    case 3:
      return "ERR_INVALID_URL";
    case 6:
      return "ENOTFOUND";
    case 28:
      return "ETIMEDOUT";
    case 47:
      return "ERR_TOO_MANY_REDIRECTS";
    default:
      return "ERR_REQUEST_FAILED";
  }
};

const debugDetails = ({ method, url, options }: RequestInputs): string =>
  options.debug
    ? `\n\nDEBUG: ${JSON.stringify({ method, url, options }, null, 2)}`
    : "";

export const throwForTransportError = (
  code: number,
  message: string,
  inputs: RequestInputs,
): void => {
  if (code === 0) {
    return;
  }

  throw new RequestError(
    transportErrorCode(code),
    `Request failed: ${message}${debugDetails(inputs)}`,
  );
};
