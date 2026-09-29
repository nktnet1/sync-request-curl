import { ResponseError } from "#/errors";
import type {
  BufferEncoding,
  GetBody,
  GetJSON,
  Response,
  UppercaseHttpVerb,
} from "#/types/definition";

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
  const responseData = {
    statusCode,
    headers,
    url: responseUrl,
    body,
  };

  const getBody = ((encoding?: BufferEncoding): string | Buffer => {
    if (responseData.statusCode >= 300) {
      throw new ResponseError(
        responseData.statusCode,
        responseData.headers,
        responseData.body,
        encoding,
      );
    }
    return encoding ? responseData.body.toString(encoding) : responseData.body;
  }) as GetBody;

  const getJSON: GetJSON = (encoding?: BufferEncoding) => {
    try {
      return JSON.parse(responseData.body.toString(encoding));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Non-Error thrown while parsing JSON (${typeof error})`;
      const parseError = new Error(
        `The response body for ${method} ${requestUrl} could not be parsed as JSON.\n\n` +
          `Body:\n${responseData.body.toString(encoding)}\n\nJSON parse error:\n${message}`,
      );
      Object.defineProperty(parseError, "cause", {
        value: error,
        configurable: true,
        writable: true,
      });
      throw parseError;
    }
  };

  return Object.assign(responseData, { getBody, getJSON });
};
