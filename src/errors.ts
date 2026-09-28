import * as v from "valibot";
import type { BufferEncoding, Response } from "#/types";

/**
 * Stable transport-neutral error codes emitted by the TypeScript request layer.
 *
 * @group Errors
 */
export type RequestErrorCode =
  | "ERR_INVALID_URL"
  | "ENOTFOUND"
  | "ETIMEDOUT"
  | "ERR_TOO_MANY_REDIRECTS"
  | "ERR_REQUEST_FAILED";

const requestErrorCodeSchema = v.picklist([
  "ERR_INVALID_URL",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ERR_TOO_MANY_REDIRECTS",
  "ERR_REQUEST_FAILED",
] as const satisfies readonly RequestErrorCode[]);

const curlErrorCodeSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(101),
);

/**
 * Raw libcurl transport failure.
 *
 * The numeric `code` is retained for compatibility with earlier
 * `sync-request-curl` releases and maps to libcurl's documented error codes.
 *
 * @group Errors
 * @noInheritDoc
 */
export class CurlError extends Error {
  /** Numeric libcurl error code. */
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

/**
 * Transport-neutral request failure created by the TypeScript request layer.
 *
 * @group Errors
 * @noInheritDoc
 */
export class RequestError extends Error {
  /** Stable transport-neutral request error code. */
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

/**
 * HTTP status error thrown by `response.getBody()` for status codes >= 300.
 *
 * The status, headers, and body that produced the error remain available on
 * the error object.
 *
 * @group Errors
 * @noInheritDoc
 */
export class ResponseError extends Error {
  /** HTTP status code that caused the error. */
  readonly statusCode: number;
  /** Response headers returned by the server. */
  readonly headers: Response["headers"];
  /** Buffered response body returned by the server. */
  readonly body: Buffer;

  constructor(
    statusCode: number,
    headers: Response["headers"],
    body: Buffer,
    encoding?: BufferEncoding,
  ) {
    super(
      `Server responded with status code ${statusCode}:\n${body.toString(encoding)}`,
    );
    this.name = "ResponseError";
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = body;
  }
}

/** @internal */
export const throwForTransportError = (code: number, message: string): void => {
  if (code === 0) {
    return;
  }

  throw new CurlError(code, `Request failed: ${message}`);
};
