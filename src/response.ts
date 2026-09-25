import type { IncomingHttpHeaders } from "node:http";
import { ResponseError } from "#/errors";
import type {
  BufferEncoding,
  GetJSON,
  Response,
  UppercaseHttpVerb,
} from "#/types";

interface CreateResponseOptions {
  method: UppercaseHttpVerb;
  requestUrl: string;
  responseUrl: string;
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export const createResponse = ({
  method,
  requestUrl,
  responseUrl,
  statusCode,
  headers,
  body,
}: CreateResponseOptions): Response => {
  const getBody = ((encoding?: BufferEncoding): string | Buffer => {
    if (statusCode >= 300) {
      throw new ResponseError(statusCode, headers, body);
    }
    return encoding ? body.toString(encoding) : body;
  }) as Response["getBody"];

  const getJSON: GetJSON = (encoding?) => {
    try {
      return JSON.parse(body.toString(encoding));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Non-Error thrown while parsing JSON (${typeof error})`;
      const parseError = new Error(
        `The response body for ${method} ${requestUrl} could not be parsed as JSON.\n\n` +
          `Body:\n${body.toString(encoding)}\n\nJSON parse error:\n${message}`,
      );
      Object.defineProperty(parseError, "cause", {
        value: error,
        configurable: true,
        writable: true,
      });
      throw parseError;
    }
  };

  return {
    statusCode,
    headers,
    url: responseUrl,
    body,
    getBody,
    getJSON,
  };
};
