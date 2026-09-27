import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application } from "typedoc";
import config from "#typedoc/typedoc.config";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readmePath = resolve(projectRoot, "README.md");
const assetsDirectory = resolve(projectRoot, "typedoc/assets");
const checkOnly = process.argv.includes("--check");

const API_SECTION = Symbol("API_SECTION");
const sections = [
  "installation.md",
  "usage.md",
  API_SECTION,
  "differences.md",
  "license.md",
  "compatibility.md",
  "caveats.md",
] as const;

type FenceMarker = "`" | "~";

type MarkdownHeading = {
  level: number;
  title: string;
};

type TocEntry = {
  depth: 0 | 1;
  label: string;
  anchor: string;
};

type RenderedSection = {
  markdown: string;
  toc: TocEntry[];
};

const DUPLICATE_COMMENT_WARNING =
  "has multiple declarations with a comment. An arbitrary comment will be used";

const readAsset = (name: string): string =>
  readFileSync(resolve(assetsDirectory, name), "utf8").trim();

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

const shiftMarkdownHeadings = (markdown: string, levels: number): string => {
  let fence: FenceMarker | undefined;
  const output: string[] = [];

  for (const line of markdown.split("\n")) {
    const nextFence = updateFence(fence, line);
    if (nextFence !== fence) {
      fence = nextFence;
      output.push(line);
      continue;
    }

    const heading = fence ? undefined : parseMarkdownHeading(line);
    output.push(
      heading && heading.level <= 6 - levels
        ? `${"#".repeat(levels)}${line}`
        : line,
    );
  }

  return output.join("\n");
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
    const closeBracket = value.indexOf("](", openBracket + 1);
    if (closeBracket === -1) {
      output += value.slice(openBracket);
      break;
    }

    const closeParenthesis = value.indexOf(")", closeBracket + 2);
    if (closeParenthesis === -1) {
      output += value.slice(openBracket);
      break;
    }

    output += value.slice(openBracket + 1, closeBracket);
    offset = closeParenthesis + 1;
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

const headingAnchor = (heading: string): string => {
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

const numberAssetSection = (
  markdown: string,
  sectionNumber: number,
  sourceName: string,
): RenderedSection => {
  let fence: FenceMarker | undefined;
  let mainAnchor: string | undefined;
  let subsectionNumber = 0;
  const output: string[] = [];
  const toc: TocEntry[] = [];

  for (const line of markdown.split("\n")) {
    const nextFence = updateFence(fence, line);
    if (nextFence !== fence) {
      fence = nextFence;
      output.push(line);
      continue;
    }

    const heading = fence ? undefined : parseMarkdownHeading(line);
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

const buildApiSection = (
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

const buildTableOfContents = (entries: TocEntry[]): string =>
  entries
    .map(
      ({ depth, label, anchor }) =>
        `${"  ".repeat(depth)}- [${label}](#${anchor})`,
    )
    .join("\n");

const buildReadme = (api: string): string => {
  const renderedSections = sections.map((section, index) => {
    const sectionNumber = index + 1;
    return section === API_SECTION
      ? buildApiSection(api, sectionNumber)
      : numberAssetSection(readAsset(section), sectionNumber, section);
  });

  const toc = buildTableOfContents(
    renderedSections.flatMap(({ toc: entries }) => entries),
  );

  return `${[
    readAsset("header.md"),
    toc,
    ...renderedSections.map(({ markdown }) => markdown),
  ].join("\n\n")}\n`;
};

const suppressKnownTypeDocWarnings = (app: Application): void => {
  type WarnArguments = Parameters<typeof app.logger.warn>;
  const warn = app.logger.warn.bind(app.logger);

  app.logger.warn = ((...args: WarnArguments): void => {
    if (args[0].includes(DUPLICATE_COMMENT_WARNING)) {
      return;
    }
    warn(...args);
  }) as typeof app.logger.warn;
};

process.chdir(projectRoot);
const outputDirectory = mkdtempSync(
  join(tmpdir(), "sync-request-curl-typedoc-"),
);

try {
  const app = await Application.bootstrapWithPlugins({
    ...config,
    out: outputDirectory,
    logLevel: "Warn",
  });
  suppressKnownTypeDocWarnings(app);

  const project = await app.convert();
  if (!project) {
    throw new Error("TypeDoc could not convert the public API");
  }

  await app.generateOutputs(project);
  const generatedApi = readFileSync(
    resolve(outputDirectory, "README.md"),
    "utf8",
  );
  const nextReadme = buildReadme(generatedApi);

  if (checkOnly) {
    const currentReadme = readFileSync(readmePath, "utf8");
    if (nextReadme !== currentReadme) {
      throw new Error(
        "README.md is stale. Run `pnpm docs:gen` and commit the result.",
      );
    }
  } else {
    writeFileSync(readmePath, nextReadme);
    console.log("README.md generated");
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
