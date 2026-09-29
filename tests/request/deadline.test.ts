import { performance } from "node:perf_hooks";
import { afterEach, expect, test, vi } from "vitest";
import { createDeadline } from "#/request/deadline";

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
