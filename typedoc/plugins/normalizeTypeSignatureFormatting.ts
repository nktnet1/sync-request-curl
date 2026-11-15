import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";
import { collectCallableTypeAliases } from "#typedoc/plugins/callableAliases";
import {
  getTypeScriptFenceMarker,
  restoreCallableTypeAliases,
} from "#typedoc/plugins/restoreCallableTypeAliases";

const normalizeTypeScriptLine = (line: string): string =>
  line
    .replace(/^(\s*[A-Za-z_$][\w$]*\??:) {3}\| /, "$1 ")
    .replace(/^<([^>]+)> {2,}\(/, "  <$1>(")
    // Keep generated signatures stable when TypeScript reorders equivalent
    // Buffer/Blob unions as source modules are reorganised.
    .replaceAll(
      "Blob | Buffer<ArrayBufferLike>",
      "Buffer<ArrayBufferLike> | Blob",
    );

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

const normalizeTypeScriptFences = (lines: string[]): void => {
  let fenceMarker: string | undefined;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart();
    if (!fenceMarker) {
      fenceMarker = getTypeScriptFenceMarker(trimmed);
      continue;
    }

    if (trimmed.startsWith(fenceMarker)) {
      fenceMarker = undefined;
      continue;
    }

    lines[index] = normalizeTypeScriptLine(line);
    groupLeadingUnionIntersection(lines, index);
  }
};

/**
 * Fix formatting artefacts emitted by typedoc-plugin-markdown in generated
 * TypeScript signatures without changing the represented types.
 */
export function normalizeTypeSignatureFormatting(app: Application): void {
  const markdownApp = app as MarkdownApplication;
  const callableTypeAliases = collectCallableTypeAliases();

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    const lines = restoreCallableTypeAliases(
      page.contents.split("\n"),
      callableTypeAliases,
    );
    normalizeTypeScriptFences(lines);
    page.contents = lines.join("\n");
  });
}
