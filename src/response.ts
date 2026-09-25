import type { IncomingHttpHeaders } from "node:http";
import { ResponseError } from "#/errors";
import type { BufferEncoding, Response, UppercaseHttpVerb } from "#/types";

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
  function getBody<Encoding extends BufferEncoding>(encoding: Encoding): string;
  function getBody(encoding?: undefined): Buffer;
  function getBody(encoding?: BufferEncoding): string | Buffer {
    if (statusCode >= 300) {
      throw new ResponseError(statusCode, headers, body);
    }
    return encoding ? body.toString(encoding) : body;
  }

  const getJSON = <T = unknown>(encoding?: BufferEncoding): T => {
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
