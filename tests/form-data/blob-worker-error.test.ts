import { Blob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const workerState = vi.hoisted(() => ({
  signalFailure: true,
  terminate: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("node:worker_threads", () => ({
  Worker: class MockWorker {
    constructor(
      _url: URL,
      options: { workerData: { state: SharedArrayBuffer } },
    ) {
      const state = new Int32Array(options.workerData.state);
      if (workerState.signalFailure) Atomics.store(state, 0, -1);
      Atomics.notify(state, 0);
    }

    unref = vi.fn();
    on = vi.fn();
    terminate = workerState.terminate;
  },
}));

import { FormData } from "#/form-data";

describe("FormData Blob worker failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerState.signalFailure = true;
  });

  test("throws when the Blob reader worker reports a failure", () => {
    const form = new FormData();

    expect(() => form.append("blob", new Blob(["contents"]))).toThrow(
      "Unable to synchronously read Blob data",
    );
  });
});

afterEach(() => vi.restoreAllMocks());

test("bounds the wait and terminates a worker that never signals", () => {
  workerState.signalFailure = false;
  const wait = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
  expect(() => new FormData().append("blob", new Blob(["contents"]))).toThrow(
    "Timed out synchronously reading Blob data",
  );
  expect(wait.mock.calls[0]?.[3]).toBeGreaterThan(0);
  expect(wait.mock.calls[0]?.[3]).toBeLessThanOrEqual(30_000);
  expect(workerState.terminate).toHaveBeenCalledOnce();
});
