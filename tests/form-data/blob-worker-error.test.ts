import { Blob } from "node:buffer";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const workerState = vi.hoisted(() => ({
  signalFailure: true,
  emitStartupError: false,
  terminate: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("node:worker_threads", () => ({
  Worker: class MockWorker extends EventEmitter {
    constructor(
      _url: URL,
      options: { workerData: { state: SharedArrayBuffer } },
    ) {
      super();
      if (workerState.emitStartupError) {
        queueMicrotask(() =>
          this.emit("error", new Error("Worker startup failed")),
        );
      }
      const state = new Int32Array(options.workerData.state);
      if (workerState.signalFailure) Atomics.store(state, 0, -1);
      Atomics.notify(state, 0);
    }

    unref = vi.fn();
    terminate = workerState.terminate;
  },
}));

import { FormData } from "#/form-data";

beforeEach(() => {
  vi.clearAllMocks();
  workerState.signalFailure = true;
  workerState.emitStartupError = false;
});

describe("FormData Blob worker failures", () => {
  test("throws when the Blob reader worker reports a failure", () => {
    const form = new FormData();

    expect(() => form.append("blob", new Blob(["contents"]))).toThrow(
      "Unable to synchronously read Blob data",
    );
  });

  test("consumes a late startup error after the synchronous timeout", async () => {
    workerState.signalFailure = false;
    workerState.emitStartupError = true;
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");

    expect(() => new FormData().append("blob", new Blob(["contents"]))).toThrow(
      "Timed out synchronously reading Blob data",
    );
    expect(workerState.terminate).toHaveBeenCalledOnce();

    // An unhandled EventEmitter error would escape when the microtask runs.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  });

  test("consumes termination rejection without masking the read failure", async () => {
    workerState.terminate.mockRejectedValueOnce(
      new Error("Termination failed"),
    );

    expect(() => new FormData().append("blob", new Blob(["contents"]))).toThrow(
      "Unable to synchronously read Blob data",
    );
    expect(workerState.terminate).toHaveBeenCalledOnce();

    // Allow the rejection handler to run; Vitest also detects unhandled rejections.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
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
