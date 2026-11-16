import { Blob } from "node:buffer";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, test, vi } from "vitest";

const workerPathState = vi.hoisted(() => ({
  localWorkerExists: false,
  manifestError: null as Error | null,
  readerPath: undefined as string | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      workerPathState.localWorkerExists || actual.existsSync(path),
  };
});

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: (url: string | URL) => {
      const require = actual.createRequire(url);
      return {
        resolve: (specifier: string) => {
          if (workerPathState.manifestError) {
            throw workerPathState.manifestError;
          }
          return require.resolve(specifier);
        },
      };
    },
  };
});

vi.mock("node:worker_threads", () => ({
  Worker: class {
    constructor(
      _script: string,
      options: { workerData: { readerPath: string; state: SharedArrayBuffer } },
    ) {
      workerPathState.readerPath = options.workerData.readerPath;
      const state = new Int32Array(options.workerData.state);
      Atomics.store(state, 0, -1);
      Atomics.notify(state, 0);
    }

    on() {
      return this;
    }

    unref() {
      return this;
    }

    terminate = () => Promise.resolve(0);
  },
}));

import { blobToBufferSync } from "#/form-data/blob";

const localWorkerPath = join(
  realpathSync(fileURLToPath(new URL("../../src/form-data", import.meta.url))),
  "internal/blob-reader-worker.cjs",
);
const installedWorkerPath = realpathSync(
  fileURLToPath(
    new URL("../../dist/internal/blob-reader-worker.cjs", import.meta.url),
  ),
);

beforeEach(() => {
  workerPathState.localWorkerExists = false;
  workerPathState.manifestError = null;
  workerPathState.readerPath = undefined;
});

const attemptBlobRead = () => blobToBufferSync(new Blob(["data"]));

test("prefers an existing worker alongside the compiled entrypoint", () => {
  workerPathState.localWorkerExists = true;
  expect(attemptBlobRead).toThrow("Unable to synchronously read Blob data");
  expect(workerPathState.readerPath).toBe(localWorkerPath);
});

test("falls back to the installed package for source imports", () => {
  expect(attemptBlobRead).toThrow("Unable to synchronously read Blob data");
  expect(workerPathState.readerPath).toBe(installedWorkerPath);
});

test("uses the local path when the package manifest cannot be resolved", () => {
  workerPathState.manifestError = Object.assign(new Error("package missing"), {
    code: "MODULE_NOT_FOUND",
  });
  expect(attemptBlobRead).toThrow("Unable to synchronously read Blob data");
  expect(workerPathState.readerPath).toBe(localWorkerPath);
});

test("does not hide unrelated package resolution failures", () => {
  workerPathState.manifestError = new Error(
    "unexpected module resolution failure",
  );
  expect(attemptBlobRead).toThrow("unexpected module resolution failure");
  expect(workerPathState.readerPath).toBeUndefined();
});
