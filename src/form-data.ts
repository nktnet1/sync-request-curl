import { Blob } from "node:buffer";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import * as v from "valibot";
import { lookupMimeType } from "#/http/mime-type";
import { parseSchema } from "#/validate";

const metadataSchema = v.pipe(
  v.string(),
  v.check(
    (value) =>
      !["\0", "\r", "\n"].some((character) => value.includes(character)),
    "Multipart metadata cannot contain NUL, CR, or LF",
  ),
);

export const formDataEntrySchema = v.object({
  /** Multipart field name. */
  key: metadataSchema,
  /** Text, `Buffer`, or `Blob` field value. */
  value: v.union([v.string(), v.instance(Buffer), v.instance(Blob)]),
  /** Optional file name. Path components are stripped before sending. */
  fileName: v.optional(metadataSchema),
});

/**
 * One multipart entry accepted by `FormData`.
 *
 * @group Multipart
 * @interface
 */
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

const blobToBufferSync = (blob: Blob): Buffer => {
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
        parseSchema(metadataSchema, getBlobFileName(value)).replaceAll(
          "\\",
          "/",
        ),
      ),
    contentType: value.type || "application/octet-stream",
  };
};

const getEntries = (form: FormData): PreparedFormDataEntry[] => {
  parseSchema(v.instance(FormData), form);
  const formEntries = entries.get(form);
  if (!formEntries) {
    throw new TypeError(
      "Expected a FormData instance created by sync-request-curl",
    );
  }
  return formEntries;
};

/**
 * Synchronous multipart/form-data builder compatible with `sync-request`.
 *
 * Pass an instance through the request `form` option.
 *
 * @group Multipart
 */
export class FormData {
  constructor() {
    entries.set(this, []);
  }

  /**
   * Append a text, `Buffer`, or `Blob` field.
   *
   * When `fileName` is supplied, its basename is used and the media type is
   * inferred from the extension with an `application/octet-stream` fallback.
   * Blob media types remain authoritative. Blob reads throw if the reader fails
   * or does not finish within 30 seconds.
   */
  append(key: string, value: string | Buffer | Blob, fileName?: string): void {
    const entry = parseSchema(formDataEntrySchema, { key, value, fileName });
    getEntries(this).push(prepareFormDataEntry(entry));
  }
}

export const getFormDataEntries = (form: FormData): PreparedFormDataEntry[] =>
  getEntries(form).map((entry) => ({ ...entry }));
