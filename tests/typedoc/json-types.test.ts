import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "typedoc";
import { expect, test } from "vitest";
import config from "#typedoc/typedoc.config";

test("renders accurate public API types and callable signatures", async () => {
  const output = mkdtempSync(join(tmpdir(), "curl-json-docs-"));
  try {
    const app = await Application.bootstrapWithPlugins({
      ...config,
      out: output,
      logLevel: "Error",
    });
    const project = await app.convert();
    if (!project) throw new Error("TypeDoc could not convert the public API");
    await app.generateOutputs(project);
    const markdown = readFileSync(join(output, "README.md"), "utf8");

    // typedoc-plugin-markdown 4.14+ marks the optional request options parameter with `?`.
    // Both forms must link to the standalone Options documentation.
    expect(markdown).toMatch(
      /^\| `options\??` \| \[`Options`\]\(#options\) \|/m,
    );

    for (const signature of [
      [
        "function request(",
        "   method: HttpVerb,",
        "   url: string | URL,",
        "   options?: Options",
        "): Response;",
      ].join("\n"),
      "getBody(encoding: BufferEncoding): string;",
      "getJSON<T = any>(encoding?: BufferEncoding): T;",
      "getHeaders(userHeaders: Headers): Headers;",
      "setBoundary(boundary: string): void;",
      "new CurlError(code: number, message: string): CurlError;",
      [
        "new RequestError(",
        "   code: RequestErrorCode,",
        "   message: string,",
        "   options?: ErrorOptions",
        "): RequestError;",
      ].join("\n"),
      [
        "new ResponseError(",
        "   statusCode: number,",
        "   headers: Headers,",
        "   body: Buffer,",
        "   encoding?: BufferEncoding,",
        "   url?: string",
        "): ResponseError;",
      ].join("\n"),
    ]) {
      expect(markdown).toContain(signature);
    }

    const appendStart = markdown.indexOf("append(\n");
    const appendEnd = markdown.indexOf("): void;", appendStart);
    expect(appendStart).toBeGreaterThanOrEqual(0);
    expect(appendEnd).toBeGreaterThan(appendStart);
    const appendSignature = markdown.slice(appendStart, appendEnd);
    for (const parameter of [
      "key: string,",
      "value: string | number | boolean | Buffer<ArrayBufferLike> | Blob,",
      "options?:",
      "filename?: string;",
      "contentType?: string;",
      "knownLength?: number;",
      "header?: string;",
    ]) {
      expect(appendSignature).toContain(parameter);
    }

    for (const excludedProperty of [
      "bearer?: never;",
      "username?: never;",
      "password?: never;",
      "type?: never;",
      "keyFile?: never;",
    ]) {
      expect(markdown).toContain(excludedProperty);
    }

    for (const type of ["JsonLike", "NestedJsonLike"]) {
      expect(markdown).toContain(`toJSON: () => ${type};`);
      expect(markdown).not.toContain(`toJSON: ${type};`);
    }

    for (const reference of [
      "[`URL`](https://nodejs.org/api/url.html#class-url)",
      "[`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)",
      "[`Blob`](https://nodejs.org/api/buffer.html#class-blob)",
      "[`Agent`](https://nodejs.org/api/http.html#class-httpagent)",
      "[`IncomingHttpHeaders`](https://nodejs.org/api/http.html#messageheaders)",
      "[`Error`](https://nodejs.org/api/errors.html#class-error)",
      "[`ErrorOptions`](https://nodejs.org/api/errors.html#new-errormessage-options)",
    ]) {
      expect(markdown).toContain(reference);
    }

    for (const property of ["headers?", "headers", "requestHeaders"]) {
      expect(markdown).toContain(`\`${property}\` | [\`Headers\`](#headers)`);
    }

    expect(markdown).toContain(
      [
        "type TlsOptions = {",
        "  minVersion?: TlsVersion;",
        "  maxVersion?: TlsVersion;",
        "} & (",
        "  | {",
      ].join("\n"),
    );
    expect(markdown).not.toContain("} &\n  | {");

    const tlsOptionsStart = markdown.indexOf("type TlsOptions = {");
    expect(tlsOptionsStart).toBeGreaterThanOrEqual(0);
    const tlsOptionsEnd = markdown.indexOf("\n```", tlsOptionsStart);
    expect(markdown.slice(tlsOptionsStart, tlsOptionsEnd)).toMatch(/\n\}\);$/);

    for (const signature of [
      [
        "type CacheIsMatchFunction = (",
        "  requestHeaders: Headers,",
        "  cachedResponse: CachedResponse,",
        "  defaultValue: boolean,",
        ") => boolean;",
      ].join("\n"),
      [
        "type CacheIsExpiredFunction = (",
        "  cachedResponse: CachedResponse,",
        "  defaultValue: boolean,",
        ") => boolean;",
      ].join("\n"),
      [
        "type CacheCanCacheFunction = (",
        "  response: CachePolicyResponse,",
        "  defaultValue: boolean,",
        ") => boolean;",
      ].join("\n"),
      [
        "type RetryFunction = (",
        "  error: CurlError | RequestError | null,",
        "  response: RetryResponse | undefined,",
        "  attemptNumber: number,",
        ") => boolean;",
      ].join("\n"),
      [
        "type RetryDelayFunction = (",
        "  error: CurlError | RequestError | null,",
        "  response: RetryResponse | undefined,",
        "  attemptNumber: number,",
        ") => number;",
      ].join("\n"),
      [
        "type GetBody = {",
        "  <Encoding extends BufferEncoding>(encoding: Encoding): string;",
        "  (): Buffer;",
        "};",
      ].join("\n"),
      "type GetJSON = <T = any>(encoding?: BufferEncoding) => T;",
    ]) {
      expect(markdown).toContain(signature);
    }

    expect(markdown).not.toContain(
      "type RetryFunction = (error, response, attemptNumber) => boolean;",
    );
    expect(markdown).not.toContain("type GetJSON = <T>(encoding?) => T;");

    const getBodySectionStart = markdown.indexOf("### GetBody");
    expect(getBodySectionStart).toBeGreaterThanOrEqual(0);
    const getBodySectionEnd = markdown.indexOf("\n***", getBodySectionStart);
    const getBodySection = markdown.slice(
      getBodySectionStart,
      getBodySectionEnd === -1 ? markdown.length : getBodySectionEnd,
    );
    const getBodyHeadlineEnd = getBodySection.indexOf(
      "\n```",
      getBodySection.indexOf("```ts") + 1,
    );
    expect(getBodyHeadlineEnd).toBeGreaterThanOrEqual(0);
    const getBodyDetails = getBodySection.slice(getBodyHeadlineEnd + 4);
    expect(getBodyDetails).toContain(
      [
        "```ts",
        "<Encoding extends BufferEncoding>(encoding: Encoding): string;",
        "```",
      ].join("\n"),
    );
    expect(getBodyDetails).not.toContain("<Encoding>(encoding): string;");

    const headersDeclaration = "type Headers = IncomingHttpHeaders;";
    const headersStart = markdown.indexOf(headersDeclaration);
    expect(headersStart).toBeGreaterThanOrEqual(0);

    const headersEnd = markdown.indexOf("\n***", headersStart);
    const headersSection = markdown.slice(
      headersStart,
      headersEnd === -1 ? markdown.length : headersEnd,
    );
    expect(headersSection).toContain(
      "[`IncomingHttpHeaders`](https://nodejs.org/api/http.html#messageheaders)",
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}, 30_000);
