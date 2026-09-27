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

const removeLeadingUnionPipe = (contents: string): string => {
  const lines = contents.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    if (!isReturnsHeading(lines[index] ?? "")) {
      continue;
    }

    let returnLineIndex = index + 1;
    while (
      returnLineIndex < lines.length &&
      (lines[returnLineIndex] ?? "").trim() === ""
    ) {
      returnLineIndex += 1;
    }

    const returnLine = lines[returnLineIndex];
    if (returnLine === undefined) {
      continue;
    }

    const pipeIndex = returnLine.indexOf("\\|");
    if (pipeIndex === -1 || returnLine.slice(0, pipeIndex).trim() !== "") {
      continue;
    }

    let valueStart = pipeIndex + 2;
    while (returnLine[valueStart] === " " || returnLine[valueStart] === "\t") {
      valueStart += 1;
    }
    lines[returnLineIndex] =
      returnLine.slice(0, pipeIndex) + returnLine.slice(valueStart);
  }

  return lines.join("\n");
};

export function removeLeadingReturnUnionPipe(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = removeLeadingUnionPipe(page.contents);
  });
}
