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
        ? `import request, { CurlError, FormData, RequestError, ResponseError } from 'sync-request-curl';
           import assert from 'node:assert/strict';`
        : `const request = require('sync-request-curl');
           const { CurlError, FormData, RequestError, ResponseError } = request;
           const assert = require('node:assert/strict');`;
    try {
      const result = spawnSync(
        process.execPath,
        [
          `--input-type=${format}`,
          "-e",
          `${imports}
           assert.equal(typeof request, 'function');
           assert.equal(request.FormData, FormData);
           assert.equal(request.CurlError, CurlError);
           assert.equal(request.RequestError, RequestError);
           assert.equal(request.ResponseError, ResponseError);
           assert.throws(() => request('GET', 'http://localhost/transport-error'), CurlError);
           assert.throws(() => request('GET', 'http://localhost/redirect', { maxRedirects: 0 }), RequestError);
           const response = request('GET', 'http://localhost/http-error');
           assert.equal(response.isError(), true);
           assert.throws(() => response.getBody(), ResponseError);
           const form = new FormData();
           form.setBoundary('entrypoint-boundary');
           form.append('message', 'hello');
           form.append('count', 3);
           assert.equal(form.getBoundary(), 'entrypoint-boundary');
           assert.equal(form.getHeaders()['content-type'], 'multipart/form-data; boundary=entrypoint-boundary');
           assert.equal(form.getLengthSync(), form.getBuffer().length);
           assert.equal(form.hasKnownLength(), true);
           assert.equal(form.toString(), '[object FormData]');
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

test("built declarations expose the public root API without leaking Node header types", () => {
  const directory = mkdtempSync(join(root, ".entrypoints-types-"));
  const fixtures = [
    join(directory, "consumer.cts"),
    join(directory, "consumer.mts"),
  ];
  const tsconfig = join(directory, "tsconfig.json");
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const consumer = String.raw`// @ts-expect-error IncomingHttpHeaders is intentionally not re-exported by this package.
     import type { IncomingHttpHeaders as PackageIncomingHttpHeaders } from "sync-request-curl";
     import request, {
       CurlError,
       FormData,
       RequestError,
       ResponseError,
       type BufferEncoding,
       type CachedResponse,
       type CacheCanCacheFunction,
       type CacheIsExpiredFunction,
       type CacheIsMatchFunction,
       type CachePolicyResponse,
       type FormDataEntry,
       type GetBody,
       type GetJSON,
       type Headers,
       type HttpAuthOptions,
       type HttpAuthType,
       type HttpVerb,
       type JsonLike,
       type JsonPrimitive,
       type NestedJsonLike,
       type Options,
       type ProxyAuthType,
       type ProxyOptions,
       type RequestErrorCode,
       type Response,
       type RetryDelayFunction,
       type RetryFunction,
       type RetryResponse,
     } from "sync-request-curl";

     const method: HttpVerb = "GET";
     const headers: Headers = { "x-test": "value" };
     const options: Options = {};
     const response: Response = request(method, "http://localhost", options);
     const form = new FormData();
     form.append("count", 3);
     form.append("enabled", true);
     form.append("file", Buffer.from("abc"), {
       filename: "report.bin",
       contentType: "application/x-report",
       knownLength: 3,
       header: "--entrypoint-boundary\r\nX-Custom-Part: yes\r\n\r\n",
     });
     const formHeaders: Headers = form.getHeaders({ "x-test": "value" });
     const formBoundary: string = form.getBoundary();
     const formBuffer: Buffer = form.getBuffer();
     const formLength: number = form.getLengthSync();
     const formKnownLength: boolean = form.hasKnownLength();
     const formString: string = form.toString();
     const attachedForm = new request.FormData();
     const curlError = new CurlError(7, "failed");
     const requestError = new RequestError("ERR_REQUEST_FAILED", "failed");
     const responseError = new ResponseError(500, {}, Buffer.alloc(0));
     const encoding: BufferEncoding = "utf8";
     const primitive: JsonPrimitive = null;
     const json: JsonLike = primitive;
     const nested: NestedJsonLike = { value: json };
     const httpAuthType: HttpAuthType = "digest";
     const httpAuth: HttpAuthOptions = {
       username: "user",
       password: "secret",
       type: httpAuthType,
     };
     const bearerAuth: HttpAuthOptions = { bearer: "token" };
     const proxyAuth: ProxyAuthType = "digest";
     const proxy: ProxyOptions = {
       url: "http://localhost",
       auth: proxyAuth,
       noProxy: ["localhost"],
       headers: { "x-proxy-trace": "trace-id" },
     };
     const errorCode: RequestErrorCode = "ERR_REQUEST_FAILED";
     const isMatch: CacheIsMatchFunction = (_headers, cached, defaultValue) => {
       const copy: CachedResponse = cached;
       return copy.body.length >= 0 && defaultValue;
     };
     const isExpired: CacheIsExpiredFunction = (_cached, defaultValue) =>
       defaultValue;
     const canCache: CacheCanCacheFunction = (cacheResponse, defaultValue) => {
       const copy: CachePolicyResponse = cacheResponse;
       return copy.statusCode > 0 && defaultValue;
     };
     let formEntry: FormDataEntry | undefined;
     let getBody: GetBody | undefined;
     let getJSON: GetJSON | undefined;
     const retry: RetryFunction = (error) =>
       error === null || (error instanceof CurlError && error.code === 7);
     const retryDelay: RetryDelayFunction = (error) =>
       error instanceof CurlError ? error.code : 0;
     let retryResponse: RetryResponse | undefined;
     void [
       response,
       headers,
       form,
       formHeaders,
       formBoundary,
       formBuffer,
       formLength,
       formKnownLength,
       formString,
       attachedForm,
       curlError,
       requestError,
       responseError,
       encoding,
       nested,
       httpAuthType,
       httpAuth,
       bearerAuth,
       proxyAuth,
       proxy,
       errorCode,
       isMatch,
       isExpired,
       canCache,
       formEntry,
       getBody,
       getJSON,
       retryDelay,
       retry,
       retryResponse,
     ];`;
  for (const fixture of fixtures) {
    writeFileSync(fixture, consumer);
  }
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        types: ["node"],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      files: ["./consumer.cts", "./consumer.mts"],
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
