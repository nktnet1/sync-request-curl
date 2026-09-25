import type { IncomingHttpHeaders } from "node:http";
import * as v from "valibot";
import type { HttpVerb, Options } from "#/types";

const requestErrorCodeSchema = v.picklist([
  "ERR_INVALID_URL",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ERR_TOO_MANY_REDIRECTS",
  "ERR_REQUEST_FAILED",
] as const);

export type RequestErrorCode = v.InferOutput<typeof requestErrorCodeSchema>;

const curlErrorCodeSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(101),
);

export class CurlError extends Error {
  // https://curl.se/libcurl/c/libcurl-errors.html
  code: number;

  constructor(code: number, message: string) {
    super(message);
    const parsedCode = v.safeParse(curlErrorCodeSchema, code);
    if (!parsedCode.success) {
      throw new Error(`
        CurlError code must be between 1 and 101. Given: ${code}.

        Please take a look at the resource below for valid Libcurl errors:
          - https://curl.se/libcurl/c/libcurl-errors.html
      `);
    }
    this.code = parsedCode.output;
    Object.setPrototypeOf(this, CurlError.prototype);
  }
}

export class RequestError extends Error {
  readonly code: RequestErrorCode;

  constructor(
    code: RequestErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        configurable: true,
        writable: true,
      });
    }
    this.name = "RequestError";
    this.code = v.parse(requestErrorCodeSchema, code);
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

  throw new CurlError(
    code,
    `Request failed: ${message}${debugDetails(inputs)}`,
  );
};
