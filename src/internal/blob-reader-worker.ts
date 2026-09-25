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
  try {
    const arrayBuffer = await blob.arrayBuffer();
    new Uint8Array(data).set(new Uint8Array(arrayBuffer));
    Atomics.store(state, 0, 1);
  } catch {
    Atomics.store(state, 0, -1);
  } finally {
    Atomics.notify(state, 0);
  }
};

main()
  .then(() => process.exit())
  .catch(() => process.exit(1));
