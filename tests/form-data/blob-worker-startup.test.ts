import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const formDataUrl = new URL("../../src/form-data.ts", import.meta.url).href;

test.each([false, true])(
  "Blob worker startup with missing asset: %s",
  (missing) => {
    const script = `
    import workerThreads from "node:worker_threads";
    import { syncBuiltinESMExports } from "node:module";
    import assert from "node:assert/strict";
    if (${missing}) {
      const OriginalWorker = workerThreads.Worker;
      workerThreads.Worker = class extends OriginalWorker {
        constructor(source, options) {
          options.workerData.readerPath += ".missing";
          super(source, options);
        }
      };
      syncBuiltinESMExports();
    }
    const { FormData } = await import(${JSON.stringify(formDataUrl)});
    const append = () => new FormData().append("blob", new Blob(["contents"]));
    if (${missing}) assert.throws(append, /Unable to synchronously read Blob data/);
    else append();
  `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  },
  15_000,
);
