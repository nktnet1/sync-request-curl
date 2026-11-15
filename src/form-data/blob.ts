import type { Blob } from "node:buffer";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const blobReaderWorkerUrl = new URL(
  "../../dist/internal/blob-reader-worker.cjs",
  import.meta.url,
);

// A bootstrap catches missing/broken worker assets before the reader can signal.
// Do not inherit CLI loaders or --input-type into this plain CommonJS worker.
const blobReaderBootstrap = `
  const { workerData } = require("node:worker_threads");
  try {
    require(workerData.readerPath);
  } catch {
    const state = new Int32Array(workerData.state);
    Atomics.store(state, 0, -1);
    Atomics.notify(state, 0);
  }
`;
const blobReadTimeoutMs = 30_000;

export const blobToBufferSync = (blob: Blob): Buffer => {
  if (blob.size === 0) {
    return Buffer.alloc(0);
  }

  const data = new SharedArrayBuffer(blob.size);
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(stateBuffer);
  const worker = new Worker(blobReaderBootstrap, {
    eval: true,
    execArgv: [],
    workerData: {
      blob,
      data,
      state: stateBuffer,
      readerPath: fileURLToPath(blobReaderWorkerUrl),
    },
  });
  // Startup errors arrive asynchronously, while this thread waits synchronously.
  // The bounded wait reports failure; consume the later event to avoid an
  // additional uncaught exception after the caller has handled that failure.
  worker.on("error", () => {
    // The synchronous wait has already reported the worker failure.
  });
  worker.unref();

  try {
    const deadline = performance.now() + blobReadTimeoutMs;
    while (Atomics.load(state, 0) === 0) {
      const remaining = deadline - performance.now();
      if (
        remaining <= 0 ||
        (Atomics.wait(state, 0, 0, remaining) === "timed-out" &&
          Atomics.load(state, 0) === 0)
      ) {
        throw new TypeError("Timed out synchronously reading Blob data");
      }
    }

    if (Atomics.load(state, 0) !== 1) {
      throw new TypeError("Unable to synchronously read Blob data");
    }
    return Buffer.from(new Uint8Array(data));
  } finally {
    worker.terminate().catch(() => {
      // Cleanup failure must not replace the synchronous read result or error.
    });
  }
};
