import {
  headingAnchor,
  parseMarkdownLines,
  shiftMarkdownHeadings,
} from "#typedoc/markdown-headings";

export type TocEntry = {
  depth: 0 | 1;
  label: string;
  anchor: string;
};

export type RenderedSection = {
  markdown: string;
  toc: TocEntry[];
};

const renderMainHeading = (
  title: string,
  sectionNumber: number,
  sourceName: string,
  currentAnchor: string | undefined,
): { anchor: string; lines: string[]; toc: TocEntry } => {
  if (currentAnchor) {
    throw new Error(
      `${sourceName} must contain exactly one level-2 section heading`,
    );
  }

  const anchor = headingAnchor(title);
  return {
    anchor,
    lines: [`<a id="${anchor}"></a>`, `## ${sectionNumber}. ${title}`],
    toc: {
      depth: 0,
      label: `${sectionNumber}. ${title}`,
      anchor,
    },
  };
};

const renderSubheading = (
  title: string,
  sectionNumber: number,
  subsectionNumber: number,
  sourceName: string,
  mainAnchor: string | undefined,
): { lines: string[]; toc: TocEntry } => {
  if (!mainAnchor) {
    throw new Error(
      `${sourceName} contains a level-3 heading before its level-2 section heading`,
    );
  }

  const anchor = `${mainAnchor}-${headingAnchor(title)}`;
  const label = `${sectionNumber}.${subsectionNumber}. ${title}`;
  return {
    lines: [`<a id="${anchor}"></a>`, `### ${label}`],
    toc: { depth: 1, label, anchor },
  };
};

export const numberAssetSection = (
  markdown: string,
  sectionNumber: number,
  sourceName: string,
): RenderedSection => {
  let mainAnchor: string | undefined;
  let subsectionNumber = 0;
  const output: string[] = [];
  const toc: TocEntry[] = [];

  for (const { line, heading } of parseMarkdownLines(markdown)) {
    if (!heading || (heading.level !== 2 && heading.level !== 3)) {
      output.push(line);
      continue;
    }

    if (heading.level === 2) {
      const rendered = renderMainHeading(
        heading.title,
        sectionNumber,
        sourceName,
        mainAnchor,
      );
      mainAnchor = rendered.anchor;
      output.push(...rendered.lines);
      toc.push(rendered.toc);
      continue;
    }

    subsectionNumber += 1;
    const rendered = renderSubheading(
      heading.title,
      sectionNumber,
      subsectionNumber,
      sourceName,
      mainAnchor,
    );
    output.push(...rendered.lines);
    toc.push(rendered.toc);
  }

  if (!mainAnchor) {
    throw new Error(`${sourceName} must contain one level-2 section heading`);
  }

  return { markdown: output.join("\n"), toc };
};

export const buildApiSection = (
  api: string,
  sectionNumber: number,
): RenderedSection => {
  const title = "API reference";
  const anchor = headingAnchor(title);
  const label = `${sectionNumber}. ${title}`;

  return {
    markdown: [
      `<a id="${anchor}"></a>`,
      `## ${label}`,
      "",
      shiftMarkdownHeadings(api.trim(), 1),
    ].join("\n"),
    toc: [{ depth: 0, label, anchor }],
  };
};

export const buildTableOfContents = (entries: TocEntry[]): string =>
  entries
    .map(
      ({ depth, label, anchor }) =>
        `${"  ".repeat(depth)}- [${label}](#${anchor})`,
    )
    .join("\n");
