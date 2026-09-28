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
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}, 30_000);
