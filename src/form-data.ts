import { Blob } from "node:buffer";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import * as v from "valibot";
import { lookupMimeType } from "#/http/mime-type";
import type { Headers } from "#/types/headers";
import { parseSchema } from "#/validate";

const metadataSchema = v.pipe(
  v.string(),
  v.check(
    (value) =>
      !["\0", "\r", "\n"].some((character) => value.includes(character)),
    "Multipart metadata cannot contain NUL, CR, or LF",
  ),
);

const boundarySchema = v.pipe(
  metadataSchema,
  v.minLength(1, "FormData boundary must not be empty"),
  v.maxLength(70, "FormData boundary must be at most 70 characters"),
  v.regex(
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/,
    "FormData boundary must contain only HTTP token characters",
  ),
);

const knownLengthSchema = v.pipe(
  v.number(),
  v.finite(),
  v.integer(),
  v.minValue(0),
);

const appendOptionsSchema = v.object({
  filename: v.optional(metadataSchema),
  contentType: v.optional(metadataSchema),
  knownLength: v.optional(knownLengthSchema),
  header: v.optional(v.string()),
});

type FormDataAppendOptions = v.InferOutput<typeof appendOptionsSchema>;

export const formDataEntrySchema = v.object({
  /** Multipart field name. */
  key: metadataSchema,
  /** Synchronously materialisable multipart field value. */
  value: v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.instance(Buffer),
    v.instance(Blob),
  ]),
  /** Optional file name. Path components are stripped before sending. */
  fileName: v.optional(metadataSchema),
  /** Optional media type override. */
  contentType: v.optional(metadataSchema),
  /** Accepted for `form-data` append-option compatibility. */
  knownLength: v.optional(knownLengthSchema),
  /** Optional raw multipart header that replaces generated part headers. */
  header: v.optional(v.string()),
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
  header: v.optional(v.string()),
});

export type PreparedFormDataEntry = v.InferOutput<
  typeof preparedFormDataEntrySchema
>;

interface FormDataState {
  entries: PreparedFormDataEntry[];
  boundary?: string;
}

const states = new WeakMap<FormData, FormDataState>();

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
const lineBreak = "\r\n";
const boundaryPrefix = "--------------------------";

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

const normalizeFileName = (fileName: string | undefined): string | undefined =>
  fileName === undefined ? undefined : basename(fileName.replaceAll("\\", "/"));

const prepareFormDataEntry = (entry: FormDataEntry): PreparedFormDataEntry => {
  const rawValue = entry.value;
  const value =
    typeof rawValue === "number" || typeof rawValue === "boolean"
      ? String(rawValue)
      : rawValue;
  const fileName = normalizeFileName(entry.fileName);
  const contentType = entry.contentType || undefined;
  const materializedValue =
    value instanceof Blob ? blobToBufferSync(value) : value;

  if (entry.header !== undefined) {
    return { key: entry.key, value: materializedValue, header: entry.header };
  }

  if (!(value instanceof Blob)) {
    const prepared: PreparedFormDataEntry = {
      key: entry.key,
      value,
      ...(fileName === undefined ? {} : { fileName }),
    };
    if (contentType !== undefined) {
      return { ...prepared, contentType };
    }
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
    value: materializedValue,
    fileName:
      fileName ??
      normalizeFileName(parseSchema(metadataSchema, getBlobFileName(value))),
    contentType: contentType ?? (value.type || "application/octet-stream"),
  };
};

const getState = (form: FormData): FormDataState => {
  parseSchema(v.instance(FormData), form);
  const state = states.get(form);
  if (!state) {
    throw new TypeError(
      "Expected a FormData instance created by sync-request-curl",
    );
  }
  return state;
};

const normalizeAppendOptions = (
  options: string | FormDataAppendOptions | undefined,
): FormDataAppendOptions => {
  if (typeof options === "string") {
    return { filename: parseSchema(metadataSchema, options) };
  }
  return options === undefined ? {} : parseSchema(appendOptionsSchema, options);
};

const escapeDispositionParameter = (value: string): string =>
  value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);

const serializeEntry = (
  boundary: string,
  entry: PreparedFormDataEntry,
): Buffer[] => {
  const value = Buffer.isBuffer(entry.value)
    ? entry.value
    : Buffer.from(entry.value);
  if (entry.header !== undefined) {
    return [Buffer.from(entry.header), value, Buffer.from(lineBreak)];
  }

  let header = `--${boundary}${lineBreak}Content-Disposition: form-data; name="${escapeDispositionParameter(entry.key)}"`;
  if (entry.fileName !== undefined) {
    header += `; filename="${escapeDispositionParameter(entry.fileName)}"`;
  }
  header += lineBreak;
  if (entry.contentType !== undefined) {
    header += `Content-Type: ${entry.contentType}${lineBreak}`;
  }
  header += lineBreak;

  return [Buffer.from(header), value, Buffer.from(lineBreak)];
};

const serializeFormData = (form: FormData): Buffer => {
  const state = getState(form);
  const boundary = form.getBoundary();
  const chunks = state.entries.flatMap((entry) =>
    serializeEntry(boundary, entry),
  );
  chunks.push(Buffer.from(`--${boundary}--${lineBreak}`));
  return Buffer.concat(chunks);
};

/**
 * Synchronous multipart/form-data builder compatible with the Node.js
 * `FormData` surface exposed by `then-request`.
 *
 * Stream-valued parts and callback/stream methods from the `form-data` package
 * are intentionally omitted because this package is synchronous-only.
 *
 * @group Multipart
 */
export class FormData {
  constructor() {
    states.set(this, { entries: [] });
  }

  /**
   * Append a synchronously materialisable multipart field.
   *
   * Numbers and booleans are converted to strings. The third argument may be a
   * filename string or the synchronous subset of `form-data` append options.
   * A custom `header` is serialized verbatim and replaces the generated
   * boundary and part headers, matching Node's `form-data` behavior. Local
   * path components are stripped from generated filenames before sending.
   */
  append(
    key: string,
    value: string | number | boolean | Buffer | Blob,
    options?:
      | string
      | {
          filename?: string;
          contentType?: string;
          knownLength?: number;
          header?: string;
        },
  ): void {
    const normalizedOptions = normalizeAppendOptions(options);
    const entry = parseSchema(formDataEntrySchema, {
      key,
      value,
      fileName: normalizedOptions.filename,
      contentType: normalizedOptions.contentType,
      knownLength: normalizedOptions.knownLength,
      header: normalizedOptions.header,
    });
    getState(this).entries.push(prepareFormDataEntry(entry));
  }

  /** Return multipart request headers, merged with optional caller headers. */
  getHeaders(): Headers & { "content-type": string };
  getHeaders(userHeaders: Headers): Headers;
  getHeaders(userHeaders: Headers = {}): Headers {
    const headers: Headers = {
      "content-type": `multipart/form-data; boundary=${this.getBoundary()}`,
    };
    for (const [name, value] of Object.entries(userHeaders)) {
      headers[name.toLowerCase()] = value;
    }
    return headers;
  }

  /** Return the boundary used to serialize this form. */
  getBoundary(): string {
    const state = getState(this);
    state.boundary ??= `${boundaryPrefix}${randomBytes(12).toString("hex")}`;
    return state.boundary;
  }

  /** Set the multipart boundary used by headers and serialization. */
  setBoundary(boundary: string): void {
    getState(this).boundary = parseSchema(boundarySchema, boundary);
  }

  /** Serialize the complete multipart payload synchronously. */
  getBuffer(): Buffer {
    return serializeFormData(this);
  }

  /** Return the exact byte length of `getBuffer()`. */
  getLengthSync(): number {
    return this.getBuffer().length;
  }

  /** All supported field values have a synchronously known length. */
  hasKnownLength(): boolean {
    getState(this);
    return true;
  }

  /** Match the identity string returned by Node's `form-data` package. */
  toString(): string {
    getState(this);
    return "[object FormData]";
  }
}

export const getFormDataEntries = (form: FormData): PreparedFormDataEntry[] =>
  getState(form).entries.map((entry) => ({ ...entry }));
