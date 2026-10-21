import { Blob } from "node:buffer";
import { Worker } from "node:worker_threads";
import { expect, test } from "vitest";

const workerUrl = new URL(
  "../../dist/internal/blob-reader-worker.cjs",
  import.meta.url,
);

const readWithWorker = async (dataSize: number) => {
  const data = new SharedArrayBuffer(dataSize);
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(stateBuffer);
  const worker = new Worker(workerUrl, {
    workerData: { blob: new Blob(["hello"]), data, state: stateBuffer },
  });

  try {
    const outcome = Atomics.wait(state, 0, 0, 5_000);
    expect(outcome).not.toBe("timed-out");
    return { status: Atomics.load(state, 0), bytes: new Uint8Array(data) };
  } finally {
    await worker.terminate();
  }
};

test("Blob worker signals success after copying its data", async () => {
  const { status, bytes } = await readWithWorker(5);
  expect(status).toBe(1);
  expect(Buffer.from(bytes).toString()).toBe("hello");
});

test("Blob worker signals failure if its destination is too small", async () => {
  const { status } = await readWithWorker(4);
  expect(status).toBe(-1);
});
