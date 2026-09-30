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
