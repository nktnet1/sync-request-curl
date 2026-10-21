import type { Blob } from "node:buffer";
import { workerData } from "node:worker_threads";

interface BlobReaderWorkerData {
  blob: Blob;
  data: SharedArrayBuffer;
  state: SharedArrayBuffer;
}

const { blob, data, state: stateBuffer } = workerData as BlobReaderWorkerData;
const state = new Int32Array(stateBuffer);

const main = async (): Promise<void> => {
  const arrayBuffer = await blob.arrayBuffer();
  new Uint8Array(data).set(new Uint8Array(arrayBuffer));
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
};

// The worker is emitted as CommonJS, so top-level await is unavailable.
// Handle the promise rejection once at this synchronous entry point.
const start = (): void => {
  main().catch(() => {
    Atomics.store(state, 0, -1);
    Atomics.notify(state, 0);
  });
};

start();
