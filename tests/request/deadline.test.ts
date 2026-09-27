import { performance } from "node:perf_hooks";
import { afterEach, expect, test, vi } from "vitest";
import { attemptTimeout, createDeadline } from "#/request/deadline";

afterEach(() => vi.restoreAllMocks());

test("a monotonic deadline expires without requiring the event loop", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  const remaining = createDeadline(20);
  clock.mockReturnValue(110.5);
  expect(remaining()).toBe(10);
  clock.mockReturnValue(120);
  expect(remaining).toThrow("Overall timeout exceeded");
  expect(createDeadline()()).toBe(0);
});

test.each([
  [100, 0, 100],
  [0, 50, 50],
  [100, 50, 50],
  [20, 50, 20],
])(
  "combines per-attempt timeout %i and remaining overall budget %i",
  (timeout, remaining, expected) => {
    expect(attemptTimeout(timeout, remaining)).toBe(expected);
  },
);
