import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "typedoc";
import { expect, test } from "vitest";
import config from "#typedoc/typedoc.config";

test("renders JSON serializers as callable properties in the API documentation", async () => {
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
