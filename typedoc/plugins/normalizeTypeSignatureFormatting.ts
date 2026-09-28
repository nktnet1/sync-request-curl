import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";

const normalizeTypeScriptLine = (line: string): string =>
  line
    .replace(/^(\s*[A-Za-z_$][\w$]*\??:) {3}\| /, "$1 ")
    .replace(/^<([^>]+)> {2,}\(/, "  <$1>(");

/**
 * Fix small whitespace artefacts emitted by typedoc-plugin-markdown in
 * generated TypeScript signatures without changing the represented types.
 */
export function normalizeTypeSignatureFormatting(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    const lines = page.contents.split("\n");
    let inTypeScriptFence = false;
    let fenceMarker = "";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const trimmed = line.trimStart();

      if (!inTypeScriptFence) {
        if (trimmed.startsWith("```ts") || trimmed.startsWith("~~~ts")) {
          inTypeScriptFence = true;
          fenceMarker = trimmed.slice(0, 3);
        }
        continue;
      }

      if (trimmed.startsWith(fenceMarker)) {
        inTypeScriptFence = false;
        fenceMarker = "";
        continue;
      }

      lines[index] = normalizeTypeScriptLine(line);
    }

    page.contents = lines.join("\n");
  });
}
