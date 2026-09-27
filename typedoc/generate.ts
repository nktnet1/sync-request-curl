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

type TocEntry = {
  depth: 0 | 1;
  label: string;
  anchor: string;
};

const readAsset = (name: string): string =>
  readFileSync(resolve(assetsDirectory, name), "utf8").trim();

const shiftMarkdownHeadings = (markdown: string, levels: number): string => {
  let fence: "`" | "~" | undefined;

  return markdown
    .split("\n")
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1]?.[0] as "`" | "~";
        fence = fence === marker ? undefined : (fence ?? marker);
        return line;
      }

      if (fence) {
        return line;
      }

      const heading = line.match(/^(#{1,5})(\s+.*)$/);
      return heading ? `${"#".repeat(levels)}${line}` : line;
    })
    .join("\n");
};

const headingAnchor = (heading: string): string => {
  const anchor = heading
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!anchor) {
    throw new Error(`Could not generate an anchor for heading: ${heading}`);
  }

  return anchor;
};

const numberAssetSection = (
  markdown: string,
  sectionNumber: number,
  sourceName: string,
): { markdown: string; toc: TocEntry[] } => {
  let fence: "`" | "~" | undefined;
  let mainAnchor: string | undefined;
  let subsectionNumber = 0;
  const output: string[] = [];
  const toc: TocEntry[] = [];

  for (const line of markdown.split("\n")) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] as "`" | "~";
      fence = fence === marker ? undefined : (fence ?? marker);
      output.push(line);
      continue;
    }

    if (fence) {
      output.push(line);
      continue;
    }

    const heading = line.match(/^(##|###)\s+(.+)$/);
    if (!heading) {
      output.push(line);
      continue;
    }

    const [, level, title] = heading;
    if (!title) {
      output.push(line);
      continue;
    }

    if (level === "##") {
      if (mainAnchor) {
        throw new Error(
          `${sourceName} must contain exactly one level-2 section heading`,
        );
      }

      mainAnchor = headingAnchor(title);
      output.push(
        `<a id="${mainAnchor}"></a>`,
        `## ${sectionNumber}. ${title}`,
      );
      toc.push({
        depth: 0,
        label: `${sectionNumber}. ${title}`,
        anchor: mainAnchor,
      });
      continue;
    }

    if (!mainAnchor) {
      throw new Error(
        `${sourceName} contains a level-3 heading before its level-2 section heading`,
      );
    }

    subsectionNumber += 1;
    const anchor = `${mainAnchor}-${headingAnchor(title)}`;
    output.push(
      `<a id="${anchor}"></a>`,
      `### ${sectionNumber}.${subsectionNumber}. ${title}`,
    );
    toc.push({
      depth: 1,
      label: `${sectionNumber}.${subsectionNumber}. ${title}`,
      anchor,
    });
  }

  if (!mainAnchor) {
    throw new Error(`${sourceName} must contain one level-2 section heading`);
  }

  return { markdown: output.join("\n"), toc };
};

const buildApiSection = (
  api: string,
  sectionNumber: number,
): { markdown: string; toc: TocEntry[] } => {
  const title = "API reference";
  const anchor = headingAnchor(title);

  return {
    markdown: [
      `<a id="${anchor}"></a>`,
      `## ${sectionNumber}. ${title}`,
      "",
      shiftMarkdownHeadings(api.trim(), 1),
    ].join("\n"),
    toc: [
      {
        depth: 0,
        label: `${sectionNumber}. ${title}`,
        anchor,
      },
    ],
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

process.chdir(projectRoot);
const outputDirectory = mkdtempSync(
  join(tmpdir(), "sync-request-curl-typedoc-"),
);

try {
  const app = await Application.bootstrapWithPlugins({
    ...config,
    out: outputDirectory,
  });
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
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
