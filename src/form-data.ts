import { Blob } from "node:buffer";
import { basename } from "node:path";
import { Worker } from "node:worker_threads";
import * as v from "valibot";
import { lookupMimeType } from "#/http/mime-type";

const metadataSchema = v.pipe(
  v.string(),
  v.check(
    (value) =>
      !["\0", "\r", "\n"].some((character) => value.includes(character)),
    "Multipart metadata cannot contain NUL, CR, or LF",
  ),
);

export const formDataEntrySchema = v.object({
  key: metadataSchema,
  value: v.union([v.string(), v.instance(Buffer), v.instance(Blob)]),
  fileName: v.optional(metadataSchema),
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

const blobReaderWorkerUrl = new URL(
  "../dist/internal/blob-reader-worker.cjs",
  import.meta.url,
);

const blobToBufferSync = (blob: Blob): Buffer => {
  if (blob.size === 0) {
    return Buffer.alloc(0);
  }

  const data = new SharedArrayBuffer(blob.size);
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const state = new Int32Array(stateBuffer);
  const worker = new Worker(blobReaderWorkerUrl, {
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
  const fileName =
    entry.fileName === undefined
      ? undefined
      : basename(entry.fileName.replaceAll("\\", "/"));

  if (!(value instanceof Blob)) {
    const prepared = {
      key: entry.key,
      value,
      fileName,
    };
    if (fileName !== undefined) {
      return {
        ...prepared,
        contentType: lookupMimeType(fileName) ?? "application/octet-stream",
      };
    }
    if (Buffer.isBuffer(value)) {
      return { ...prepared, contentType: "application/octet-stream" };
    }
    return prepared;
  }

  return {
    key: entry.key,
    value: blobToBufferSync(value),
    fileName:
      fileName ??
      basename(
        v.parse(metadataSchema, getBlobFileName(value)).replaceAll("\\", "/"),
      ),
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
