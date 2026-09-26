import { CurlError } from "#/errors";
import type { Options, Response, UppercaseHttpVerb } from "#/types";

export const defaultRetryDelay = 200;
export const defaultMaxRetries = 5;

const retryWaitArray = new Int32Array(new SharedArrayBuffer(4));

export const waitForRetry = (delay: number): void => {
  if (delay <= 0) {
    return;
  }

  Atomics.wait(retryWaitArray, 0, 0, delay);
};

export const canRetryRequest = (
  method: UppercaseHttpVerb,
  retry: Options["retry"],
): retry is NonNullable<Options["retry"]> =>
  method === "GET" && retry !== undefined && retry !== false;

export const shouldRetryRequest = (
  retry: NonNullable<Options["retry"]>,
  error: CurlError | null,
  response: Response | undefined,
  attemptNumber: number,
): boolean => {
  if (typeof retry === "function") {
    return retry(error, response, attemptNumber);
  }

  return (
    error !== null || (response !== undefined && response.statusCode >= 400)
  );
};

export const getRetryDelay = (
  retryDelay: Options["retryDelay"],
  error: CurlError | null,
  response: Response | undefined,
  attemptNumber: number,
): number => {
  const delay =
    typeof retryDelay === "function"
      ? retryDelay(error, response, attemptNumber)
      : (retryDelay ?? defaultRetryDelay);

  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError(
      `retryDelay must resolve to a finite non-negative number. Given: ${delay}`,
    );
  }

  return delay;
};

export const isRetryableRequestError = (error: unknown): error is CurlError =>
  error instanceof CurlError;
