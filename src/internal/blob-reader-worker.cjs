const { workerData } = require("node:worker_threads");

const state = new Int32Array(workerData.state);

const main = async () => {
  try {
    const arrayBuffer = await workerData.blob.arrayBuffer();
    new Uint8Array(workerData.data).set(new Uint8Array(arrayBuffer));
    Atomics.store(state, 0, 1);
  } catch {
    Atomics.store(state, 0, -1);
  } finally {
    Atomics.notify(state, 0);
  }
};

void main();
