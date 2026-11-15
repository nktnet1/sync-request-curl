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

const readMarkdownLink = (
  value: string,
  openBracket: number,
): { label: string; nextOffset: number } | undefined => {
  const closeBracket = value.indexOf("](", openBracket + 1);
  if (closeBracket === -1) return undefined;
  const closeParenthesis = value.indexOf(")", closeBracket + 2);
  if (closeParenthesis === -1) return undefined;
  return {
    label: value.slice(openBracket + 1, closeBracket),
    nextOffset: closeParenthesis + 1,
  };
};

const stripMarkdownLinks = (value: string): string => {
  let output = "";
  let offset = 0;
  while (offset < value.length) {
    const openBracket = value.indexOf("[", offset);
    if (openBracket === -1) {
      output += value.slice(offset);
      break;
    }
    output += value.slice(offset, openBracket);
    const link = readMarkdownLink(value, openBracket);
    if (!link) {
      output += value.slice(openBracket);
      break;
    }
    output += link.label;
    offset = link.nextOffset;
  }
  return output;
};

const stripHeadingMarkup = (heading: string): string => {
  const withoutLinks = stripMarkdownLinks(heading);
  let output = "";
  let insideTag = false;

  for (const character of withoutLinks) {
    if (character === "<") {
      insideTag = true;
      continue;
    }
    if (character === ">" && insideTag) {
      insideTag = false;
      continue;
    }
    if (insideTag || "`*_~".includes(character)) {
      continue;
    }
    output += character;
  }

  return output;
};

export const headingAnchor = (heading: string): string => {
  const plainHeading = stripHeadingMarkup(heading).toLowerCase();
  let anchor = "";
  let pendingSeparator = false;

  for (const character of plainHeading) {
    const isAsciiLetter = character >= "a" && character <= "z";
    const isDigit = character >= "0" && character <= "9";
    if (isAsciiLetter || isDigit) {
      if (pendingSeparator && anchor) {
        anchor += "-";
      }
      anchor += character;
      pendingSeparator = false;
    } else if (anchor) {
      pendingSeparator = true;
    }
  }

  if (!anchor) {
    throw new Error(`Could not generate an anchor for heading: ${heading}`);
  }

  return anchor;
};
