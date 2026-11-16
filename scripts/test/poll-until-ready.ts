import { setTimeout as delay } from "node:timers/promises";

/**
 * Polls sequentially until the probe succeeds or the deadline is reached.
 * A new probe is never started while an earlier probe is still pending.
 */
export const pollUntilReady = async (
  probe: () => Promise<boolean>,
  intervalMs: number,
  deadline: number,
): Promise<boolean> => {
  if (Date.now() >= deadline) {
    return false;
  }
  if (await probe()) {
    return true;
  }

  await delay(intervalMs);
  return pollUntilReady(probe, intervalMs, deadline);
};
