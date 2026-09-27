import { ResponseError } from "#/errors";
import type {
  BufferEncoding,
  GetBody,
  Response,
  UppercaseHttpVerb,
} from "#/types";

type CreateResponseOptions = Pick<
  Response,
  "statusCode" | "headers" | "body"
> & {
  method: UppercaseHttpVerb;
  requestUrl: string;
  responseUrl: string;
};

export const createResponse = ({
  method,
  requestUrl,
  responseUrl,
  statusCode,
  headers,
  body,
}: CreateResponseOptions): Response => {
  const getBody = ((encoding?: BufferEncoding): string | Buffer => {
    if (response.statusCode >= 300) {
      throw new ResponseError(
        response.statusCode,
        response.headers,
        response.body,
        encoding,
      );
    }
    return encoding ? response.body.toString(encoding) : response.body;
  }) as GetBody;

  const getJSON = <T = unknown>(encoding?: BufferEncoding): T => {
    try {
      return JSON.parse(response.body.toString(encoding));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Non-Error thrown while parsing JSON (${typeof error})`;
      const parseError = new Error(
        `The response body for ${method} ${requestUrl} could not be parsed as JSON.\n\n` +
          `Body:\n${response.body.toString(encoding)}\n\nJSON parse error:\n${message}`,
      );
      Object.defineProperty(parseError, "cause", {
        value: error,
        configurable: true,
        writable: true,
      });
      throw parseError;
    }
  };

  const response: Response = {
    statusCode,
    headers,
    url: responseUrl,
    body,
    getBody,
    getJSON,
  };
  return response;
};
