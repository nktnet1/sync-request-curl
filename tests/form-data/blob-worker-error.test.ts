import { Blob } from "node:buffer";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:worker_threads", () => ({
  Worker: class MockWorker {
    constructor(
      _url: URL,
      options: { workerData: { state: SharedArrayBuffer } },
    ) {
      const state = new Int32Array(options.workerData.state);
      Atomics.store(state, 0, -1);
      Atomics.notify(state, 0);
    }

    unref = vi.fn();
  },
}));

import { FormData } from "#/form-data";

describe("FormData Blob worker failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("throws when the Blob reader worker reports a failure", () => {
    const form = new FormData();

    expect(() => form.append("blob", new Blob(["contents"]))).toThrow(
      "Unable to synchronously read Blob data",
    );
  });
});
