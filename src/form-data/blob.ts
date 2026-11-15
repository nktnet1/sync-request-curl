import type { Blob } from "node:buffer";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

// Resolve the package root rather than a path relative to this source module.
// Bundlers relocate this module from src/form-data/ to dist/index.cjs, so a
// relative URL silently points outside the published package after bundling.
const packageManifest = createRequire(import.meta.url).resolve(
  "sync-request-curl/package.json",
);
const blobReaderWorkerPath = join(
  dirname(packageManifest),
  "dist/internal/blob-reader-worker.cjs",
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
      readerPath: blobReaderWorkerPath,
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
