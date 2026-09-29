import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Exercise the published export map in fresh Node processes. Source imports
// cannot detect constructors duplicated by separate bundler invocations.
for (const format of ["module", "commonjs"]) {
  test(`built ${format} entrypoints share constructors`, () => {
    const directory = mkdtempSync(join(tmpdir(), "curl-entrypoints-"));
    const binding = join(directory, "binding.cjs");
    writeFileSync(
      binding,
      `module.exports = {
        request(options) {
          return {
            transportCode: options.url.endsWith('/transport-error') ? 7 : 0,
            transportMessage: 'Could not connect to server',
            statusCode: options.url.endsWith('/http-error') ? 404 : 200,
            effectiveUrl: options.url,
            redirectUrl: options.url.endsWith('/redirect') ? options.url : null,
            headers: [],
            body: Buffer.from('{}'),
          };
        },
        createConnectionPool() { return 1; },
        releaseConnectionPool() {},
      };`,
    );
    const imports =
      format === "module"
        ? `import request, { FormData as RootFormData } from 'sync-request-curl';
           import { FormData } from 'sync-request-curl/types';
           import { CurlError, RequestError, ResponseError } from 'sync-request-curl/errors';
           import assert from 'node:assert/strict';`
        : `const request = require('sync-request-curl');
           const RootFormData = request.FormData;
           const { FormData } = require('sync-request-curl/types');
           const { CurlError, RequestError, ResponseError } = require('sync-request-curl/errors');
           const assert = require('node:assert/strict');`;
    try {
      const result = spawnSync(
        process.execPath,
        [
          `--input-type=${format}`,
          "-e",
          `${imports}
           assert.equal(typeof request, 'function');
           assert.throws(() => request('GET', 'http://localhost/transport-error'), CurlError);
           assert.throws(() => request('GET', 'http://localhost/redirect', { maxRedirects: 0 }), RequestError);
           const response = request('GET', 'http://localhost/http-error');
           assert.throws(() => response.getBody(), ResponseError);
           assert.equal(RootFormData, FormData);
           assert.equal(request.FormData, FormData);
           const form = new FormData();
           form.append('message', 'hello');
           assert.equal(request('POST', 'http://localhost/ok', { form }).statusCode, 200);`,
        ],
        {
          cwd: root,
          env: { ...process.env, SYNC_REQUEST_CURL_NATIVE_PATH: binding },
          encoding: "utf8",
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("built CommonJS declarations expose the sync-request root API", () => {
  const directory = mkdtempSync(join(root, ".entrypoints-types-"));
  const fixture = join(directory, "consumer.cts");
  const tsconfig = join(directory, "tsconfig.json");
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  writeFileSync(
    fixture,
    `import request, {
       FormData,
       type HttpVerb,
       type Options,
       type Response,
     } from "sync-request-curl";

     const method: HttpVerb = "GET";
     const options: Options = {};
     const response: Response = request(method, "http://localhost", options);
     const form = new FormData();
     const attachedForm = new request.FormData();
     void [response, form, attachedForm];`,
  );
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      files: ["./consumer.cts"],
    }),
  );

  try {
    const result = spawnSync(process.execPath, [tsc, "--project", tsconfig], {
      cwd: root,
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
