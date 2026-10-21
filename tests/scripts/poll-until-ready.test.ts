import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { pollUntilReady } from "#scripts/poll-until-ready";

// Vitest fake timers do not advance Node's timers/promises directly.
vi.mock("node:timers/promises", () => ({
  setTimeout: (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
}));

describe("pollUntilReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("succeeds immediately without scheduling another probe", async () => {
    const probe = vi.fn().mockResolvedValue(true);

    await expect(pollUntilReady(probe, 50, Date.now() + 100)).resolves.toBe(
      true,
    );
    expect(probe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("retries only after the configured interval", async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = pollUntilReady(probe, 50, Date.now() + 500);

    await vi.advanceTimersByTimeAsync(49);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("stops polling at the deadline", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const result = pollUntilReady(probe, 50, Date.now() + 100);

    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test("does not start another probe until the previous one settles", async () => {
    let finishFirst!: (result: boolean) => void;
    const probe = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(true);
    const result = pollUntilReady(probe, 50, Date.now() + 500);

    await vi.advanceTimersByTimeAsync(100);
    expect(probe).toHaveBeenCalledTimes(1);

    finishFirst(false);
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test("propagates fatal probe failures", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("Process exited"));

    await expect(pollUntilReady(probe, 50, Date.now() + 500)).rejects.toThrow(
      "Process exited",
    );
    expect(probe).toHaveBeenCalledOnce();
  });

  test("does not probe after the deadline", async () => {
    const probe = vi.fn();

    await expect(pollUntilReady(probe, 50, Date.now())).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
