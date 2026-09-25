import { CurlError } from "#/errors";
import type { Response, UppercaseHttpVerb } from "#/types";

export const DEFAULT_RETRY_DELAY = 200;
export const DEFAULT_MAX_RETRIES = 5;

const retryWaitArray = new Int32Array(new SharedArrayBuffer(4));

export const waitForRetry = (delay: number): void => {
  if (delay <= 0) {
    return;
  }

  Atomics.wait(retryWaitArray, 0, 0, delay);
};

export const canRetryRequest = (
  method: UppercaseHttpVerb,
  retry: boolean | undefined,
): boolean => method === "GET" && retry === true;

export const shouldRetryResponse = (response: Response): boolean =>
  response.statusCode >= 400;

export const isRetryableRequestError = (error: unknown): error is CurlError =>
  error instanceof CurlError;
