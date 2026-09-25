import { throwForTransportError } from "#/errors";
import { parseResponseHeaders } from "#/http/headers";
import native from "#/native/index";
import { prepareRequest } from "#/request/prepare";
import { createResponse } from "#/response";
import type { Options, Response, UppercaseHttpVerb } from "#/types";

export interface RequestResult {
  response: Response;
  redirectUrl: string | null;
}

export const performRequest = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
): RequestResult => {
  const { url: requestUrl, headers, body, form } = prepareRequest(url, options);

  const result = native.request({
    method,
    url: requestUrl,
    headers,
    ...(body === undefined ? {} : { body }),
    ...(form === undefined ? {} : { form }),
    timeout: options.timeout ?? 0,
    noBody: method === "HEAD",
  });

  throwForTransportError(result.transportCode, result.transportMessage, {
    method,
    url,
    options,
  });

  return {
    response: createResponse({
      method,
      requestUrl: url,
      responseUrl: result.effectiveUrl ?? requestUrl,
      statusCode: result.statusCode,
      headers: parseResponseHeaders(result.headers),
      body: result.body,
    }),
    redirectUrl: result.redirectUrl,
  };
};
