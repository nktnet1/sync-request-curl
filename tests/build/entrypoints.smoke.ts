import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

type ModuleFormat = "module" | "commonjs";

// Exercise the published export map in fresh Node processes. Source imports
// cannot detect constructors or state duplicated by separate bundler invocations.
const runEntrypointCheck = (format: ModuleFormat, script: string): void => {
  const directory = mkdtempSync(join(tmpdir(), "curl-entrypoints-"));
  const binding = join(directory, "binding.cjs");
  writeFileSync(
    binding,
    `let version = 1;
      module.exports = {
        calls: [],
        request(options) {
          this.calls.push(options.method);
          if (options.method === 'PUT') version += 1;
          const statusCode = options.url.endsWith('/http-error') ? 404 : options.method === 'PUT' ? 204 : 200;
          return {
            transportCode: options.url.endsWith('/transport-error') ? 7 : 0,
            transportMessage: 'Could not connect to server',
            statusCode,
            effectiveUrl: options.url,
            redirectUrl: options.url.endsWith('/redirect') ? options.url : null,
            headers: [
              'HTTP/1.1 ' + statusCode,
              'Cache-Control: max-age=3600',
              'Date: ' + new Date().toUTCString(),
              'Content-Type: application/json',
              '',
            ],
            body: statusCode === 204 ? Buffer.alloc(0) : Buffer.from(JSON.stringify({ version })),
          };
        },
        createConnectionPool() { return 1; },
        releaseConnectionPool() {},
      };`,
  );
  try {
    const result = spawnSync(
      process.execPath,
      [`--input-type=${format}`, "-e", script],
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
};

for (const format of ["module", "commonjs"] as const) {
  test(`built ${format} entrypoint exposes its constructors`, () => {
    const imports =
      format === "module"
        ? `import request, { CurlError, FormData, RequestError, ResponseError } from 'sync-request-curl';
           import assert from 'node:assert/strict';`
        : `const request = require('sync-request-curl');
           const { CurlError, FormData, RequestError, ResponseError } = request;
           const assert = require('node:assert/strict');`;
    runEntrypointCheck(
      format,
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
    );
  });

  const mixedImports = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const loadCommonJS = () => require('sync-request-curl');
    const loadESM = async () => (await import('sync-request-curl')).default;
    const first = await ${format === "module" ? "loadESM()" : "loadCommonJS()"};
    const second = await ${format === "module" ? "loadCommonJS()" : "loadESM()"};
  `;

  test(`mixed entrypoints share constructors and accept forms when ${format} loads first`, () => {
    runEntrypointCheck(
      "module",
      `${mixedImports}
      assert.equal(first, second);
      assert.equal(first.default, first);
      for (const name of ['FormData', 'CurlError', 'RequestError', 'ResponseError']) {
        assert.equal(first[name], second[name]);
      }
      for (const [client, other] of [[first, second], [second, first]]) {
        const form = new other.FormData();
        form.append('message', 'hello');
        assert.equal(client('POST', 'http://localhost/ok', { form }).statusCode, 200);
        assert.throws(() => client('GET', 'http://localhost/transport-error'), other.CurlError);
        assert.throws(() => client('GET', 'http://localhost/redirect', { maxRedirects: 0 }), other.RequestError);
        assert.throws(() => client('GET', 'http://localhost/http-error').getBody(), other.ResponseError);
      }
    `,
    );
  });

  test(`mixed entrypoints invalidate shared memory cache when ${format} loads first`, () => {
    runEntrypointCheck(
      "module",
      `${mixedImports}
      const options = { cache: 'memory', cacheNamespace: process.env.SYNC_REQUEST_CURL_NATIVE_PATH };
      const url = 'http://localhost/resource';
      let version = 1;
      for (const [reader, writer] of [[first, second], [second, first]]) {
        assert.deepEqual(reader('GET', url, options).getJSON(), { version });
        assert.equal(writer('PUT', url, options).statusCode, 204);
        version += 1;
        assert.deepEqual(reader('GET', url, options).getJSON(), { version });
        assert.deepEqual(reader('GET', url, options).getJSON(), { version });
      }
      assert.deepEqual(require(process.env.SYNC_REQUEST_CURL_NATIVE_PATH).calls, ['GET', 'PUT', 'GET', 'PUT', 'GET']);
    `,
    );
  });
}

test("built declarations expose the public root API without leaking Node header types", () => {
  const directory = mkdtempSync(join(root, ".entrypoints-types-"));
  // Compile an installed copy without source files or the repository's imports.
  const installedPackage = join(directory, "node_modules", "sync-request-curl");
  mkdirSync(installedPackage, { recursive: true });
  cpSync(join(root, "package.json"), join(installedPackage, "package.json"));
  cpSync(join(root, "dist"), join(installedPackage, "dist"), {
    recursive: true,
  });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "entrypoint-consumer",
      private: true,
      type: "module",
    }),
  );
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
       type HttpVersion,
       type IpFamily,
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
       type TlsCertificateType,
       type TlsOptions,
       type TlsVersion,
     } from "sync-request-curl";

     const method: HttpVerb = "GET";
     let httpVersion: HttpVersion | undefined;
     let ipFamily: IpFamily | undefined;
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
     const attachedFormData: typeof FormData = request.FormData;
     options.form = form;
     const curlError = new CurlError(7, "failed");
     const requestError = new RequestError("ERR_REQUEST_FAILED", "failed");
     const responseError = new ResponseError(500, {}, Buffer.alloc(0));
     const typedForm: FormData = form;
     const typedCurlError: CurlError = curlError;
     const typedRequestError: RequestError = requestError;
     const typedResponseError: ResponseError = responseError;
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
     const tlsVersion: TlsVersion = "TLSv1.2";
     const tlsCertificateType: TlsCertificateType = "p12";
     const tls: TlsOptions = {
       certFile: "./client.p12",
       certType: tlsCertificateType,
       passphrase: "secret",
       minVersion: tlsVersion,
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
       httpVersion,
       ipFamily,
       headers,
       form,
       formHeaders,
       formBoundary,
       formBuffer,
       formLength,
       formKnownLength,
       formString,
       attachedForm,
       attachedFormData,
       curlError,
       requestError,
       responseError,
       typedForm,
       typedCurlError,
       typedRequestError,
       typedResponseError,
       encoding,
       nested,
       httpAuthType,
       httpAuth,
       bearerAuth,
       proxyAuth,
       proxy,
       tlsVersion,
       tlsCertificateType,
       tls,
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
    join(directory, "consumer-require.cts"),
    `import request = require("sync-request-curl");
      const options: request.Options = {};
      const response: request.Response = request("GET", "http://localhost", options);
      const form: request.FormData = new request.FormData();
      const curlError: request.CurlError = new request.CurlError(7, "failed");
      const requestError: request.RequestError = new request.RequestError("ERR_REQUEST_FAILED", "failed");
      const responseError: request.ResponseError = new request.ResponseError(500, {}, Buffer.alloc(0));
      const defaultRequest: typeof request = request.default;
      options.form = form;
      void [response, curlError, requestError, responseError, defaultRequest];`,
  );
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        types: ["node"],
        strict: true,
        noEmit: true,
      },
      files: ["./consumer.cts", "./consumer.mts", "./consumer-require.cts"],
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
