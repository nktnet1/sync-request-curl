import { performance } from "node:perf_hooks";
import { RequestError } from "#/errors";

/** Monotonic deadline shared by redirects, retries, and retry sleeps. */
export const createDeadline = (timeout = 0): (() => number) => {
  const end = performance.now() + timeout;
  return () => {
    if (timeout === 0) return 0;
    const remaining = Math.ceil(end - performance.now());
    if (remaining <= 0) {
      throw new RequestError(
        "ETIMEDOUT",
        "Request failed: Overall timeout exceeded",
      );
    }
    return remaining;
  };
};
