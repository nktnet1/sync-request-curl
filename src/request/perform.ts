import { getCachedResponse } from "#/request/cache";
import {
  prepareRequestCache,
  updateRequestCache,
} from "#/request/perform-cache";
import {
  createRequestResult,
  performRequestWithRetry,
  type RequestResult,
} from "#/request/perform-transport";
import { prepareRequest } from "#/request/prepare";
import { prepareTransportOptions } from "#/request/transport-options";
import type { Options, UppercaseHttpVerb } from "#/types/definition";

export type { RequestResult } from "#/request/perform-transport";

export const performRequest = (
  method: UppercaseHttpVerb,
  url: string,
  options: Options,
  remaining: () => number = () => 0,
): RequestResult => {
  remaining();
  prepareTransportOptions(options);
  const prepared = prepareRequest(url, options, method);
  const context = prepareRequestCache(method, prepared, options);
  remaining();
  if (context.lookup.useCachedResponse && context.lookup.entry) {
    return createRequestResult(
      method,
      url,
      getCachedResponse(context.lookup.entry),
    );
  }
  const result = performRequestWithRetry(
    method,
    url,
    options,
    { ...prepared, headers: context.lookup.revalidationHeaders },
    remaining,
  );
  const finalResult = updateRequestCache({
    method,
    url,
    options,
    prepared,
    context,
    result,
  });
  remaining();
  return finalResult;
};
