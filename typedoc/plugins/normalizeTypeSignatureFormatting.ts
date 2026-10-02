import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";

const normalizeTypeScriptLine = (line: string): string =>
  line
    .replace(/^(\s*[A-Za-z_$][\w$]*\??:) {3}\| /, "$1 ")
    .replace(/^<([^>]+)> {2,}\(/, "  <$1>(");

const groupLeadingUnionIntersection = (
  lines: string[],
  intersectionIndex: number,
): void => {
  const intersectionLine = lines[intersectionIndex];
  const nextLine = lines[intersectionIndex + 1];

  if (
    !intersectionLine?.trimEnd().endsWith("} &") ||
    !nextLine?.trimStart().startsWith("| {")
  ) {
    return;
  }

  let closingIndex: number | undefined;
  for (let index = intersectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line?.trim() === "};") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === undefined) {
    return;
  }

  lines[intersectionIndex] = `${intersectionLine.trimEnd()} (`;
  lines[closingIndex] = (lines[closingIndex] ?? "").replace("};", "});");
};

/**
 * Fix formatting artefacts emitted by typedoc-plugin-markdown in generated
 * TypeScript signatures without changing the represented types.
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
      groupLeadingUnionIntersection(lines, index);
    }

    page.contents = lines.join("\n");
  });
}
