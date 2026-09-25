import { Blob } from "node:buffer";
import { Worker } from "node:worker_threads";
import * as v from "valibot";

export const formDataEntrySchema = v.object({
  key: v.string(),
  value: v.union([v.string(), v.instance(Buffer), v.instance(Blob)]),
  fileName: v.optional(v.string()),
});

export type FormDataEntry = v.InferOutput<typeof formDataEntrySchema>;

export const preparedFormDataEntrySchema = v.object({
  key: v.string(),
  value: v.union([v.string(), v.instance(Buffer)]),
  fileName: v.optional(v.string()),
  contentType: v.optional(v.string()),
});

export type PreparedFormDataEntry = v.InferOutput<
  typeof preparedFormDataEntrySchema
>;

const entries = new WeakMap<FormData, PreparedFormDataEntry[]>();

/**
 * Blob exposes only asynchronous readers. A worker can await the public Blob
 * API while the calling thread blocks on shared state, keeping append synchronous.
 */
const blobReaderSource = `
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

  main();
`;

const blobToBufferSync = (blob: Blob): Buffer => {
  if (blob.size === 0) {
    return Buffer.alloc(0);
  }

  const data = new SharedArrayBuffer(blob.size);
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(stateBuffer);
  const worker = new Worker(blobReaderSource, {
    eval: true,
    workerData: { blob, data, state: stateBuffer },
  });
  worker.unref();

  while (Atomics.load(state, 0) === 0) {
    Atomics.wait(state, 0, 0);
  }

  const result = Atomics.load(state, 0);
  if (result !== 1) {
    throw new TypeError("Unable to synchronously read Blob data");
  }

  return Buffer.from(new Uint8Array(data));
};

const getBlobFileName = (blob: Blob): string => {
  const name = (blob as Blob & { name?: unknown }).name;
  return typeof name === "string" ? name : "blob";
};

const prepareFormDataEntry = (entry: FormDataEntry): PreparedFormDataEntry => {
  const value = entry.value;

  if (!(value instanceof Blob)) {
    return {
      key: entry.key,
      value,
      fileName: entry.fileName,
    };
  }

  return {
    key: entry.key,
    value: blobToBufferSync(value),
    fileName: entry.fileName ?? getBlobFileName(value),
    contentType: value.type || "application/octet-stream",
  };
};

const getEntries = (form: FormData): PreparedFormDataEntry[] => {
  v.parse(v.instance(FormData), form);
  const formEntries = entries.get(form);
  if (!formEntries) {
    throw new TypeError(
      "Expected a FormData instance created by sync-request-curl",
    );
  }
  return formEntries;
};

/**
 * A synchronous multipart/form-data builder compatible with sync-request.
 */
export class FormData {
  constructor() {
    entries.set(this, []);
  }

  append(key: string, value: string | Buffer | Blob, fileName?: string): void {
    const entry = v.parse(formDataEntrySchema, { key, value, fileName });
    getEntries(this).push(prepareFormDataEntry(entry));
  }
}

export const getFormDataEntries = (form: FormData): PreparedFormDataEntry[] =>
  getEntries(form).map((entry) => ({ ...entry }));
