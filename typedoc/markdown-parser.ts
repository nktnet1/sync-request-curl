type FenceMarker = "`" | "~";

export type MarkdownHeading = {
  level: number;
  title: string;
};

const getFenceMarker = (line: string): FenceMarker | undefined => {
  let offset = 0;
  while (line[offset] === " " || line[offset] === "\t") {
    offset += 1;
  }

  const marker = line[offset];
  if (marker !== "`" && marker !== "~") {
    return undefined;
  }

  let length = 0;
  while (line[offset + length] === marker) {
    length += 1;
  }

  return length >= 3 ? marker : undefined;
};

const updateFence = (
  current: FenceMarker | undefined,
  line: string,
): FenceMarker | undefined => {
  const marker = getFenceMarker(line);
  if (!marker) {
    return current;
  }
  if (!current) {
    return marker;
  }
  return current === marker ? undefined : current;
};

const parseMarkdownHeading = (line: string): MarkdownHeading | undefined => {
  if (!line.startsWith("#")) {
    return undefined;
  }

  let level = 0;
  while (line[level] === "#") {
    level += 1;
  }

  if (level > 6 || (line[level] !== " " && line[level] !== "\t")) {
    return undefined;
  }

  const title = line.slice(level + 1).trim();
  return title ? { level, title } : undefined;
};

type ParsedMarkdownLine = {
  line: string;
  heading?: MarkdownHeading;
};

export const parseMarkdownLines = (markdown: string): ParsedMarkdownLine[] => {
  let fence: FenceMarker | undefined;
  const lines: ParsedMarkdownLine[] = [];

  for (const line of markdown.split("\n")) {
    const nextFence = updateFence(fence, line);
    if (nextFence !== fence) {
      fence = nextFence;
      lines.push({ line });
      continue;
    }

    lines.push({
      line,
      heading: fence ? undefined : parseMarkdownHeading(line),
    });
  }

  return lines;
};

export const shiftMarkdownHeadings = (
  markdown: string,
  levels: number,
): string =>
  parseMarkdownLines(markdown)
    .map(({ line, heading }) =>
      heading && heading.level <= 6 - levels
        ? `${"#".repeat(levels)}${line}`
        : line,
    )
    .join("\n");
