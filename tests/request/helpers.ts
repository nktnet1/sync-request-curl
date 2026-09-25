import request from "#/index";
import type { HttpVerb, Options } from "#/types";

export const wrapperRequest = (
  method: HttpVerb,
  url: string,
  option?: Options,
) => {
  const rawResponse = request(method, url, option);
  let json: unknown;

  try {
    json = JSON.parse(rawResponse.body.toString());
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : `Non-Error thrown while parsing JSON (${typeof error})`;
    json = {
      error: `Failed to parse JSON: ${message}`,
    };
  }

  return {
    rawResponse,
    json,
    code: rawResponse.statusCode,
  };
};
