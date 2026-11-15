import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";

const isReturnsHeading = (line: string): boolean => {
  let level = 0;
  while (line[level] === "#") {
    level += 1;
  }
  return level >= 1 && level <= 6 && line.slice(level).trim() === "Returns";
};

const nextReturnLine = (lines: string[], headingIndex: number): number => {
  let index = headingIndex + 1;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1;
  return index;
};

const stripUnionPipe = (line: string): string => {
  const pipeIndex = line.indexOf(String.raw`\|`);
  if (pipeIndex === -1 || line.slice(0, pipeIndex).trim() !== "") return line;

  let valueStart = pipeIndex + 2;
  while (line[valueStart] === " " || line[valueStart] === "\t") valueStart += 1;
  return line.slice(0, pipeIndex) + line.slice(valueStart);
};

const removeLeadingUnionPipe = (contents: string): string => {
  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!isReturnsHeading(lines[index] ?? "")) continue;
    const returnLineIndex = nextReturnLine(lines, index);
    const returnLine = lines[returnLineIndex];
    if (returnLine !== undefined)
      lines[returnLineIndex] = stripUnionPipe(returnLine);
  }
  return lines.join("\n");
};

export function removeLeadingReturnUnionPipe(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = removeLeadingUnionPipe(page.contents);
  });
}
