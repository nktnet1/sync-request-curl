import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application } from "typedoc";
import { getRustVersionLabel } from "#scripts/build/rust-toolchain";
import {
  buildApiSection,
  buildTableOfContents,
  numberAssetSection,
} from "#typedoc/markdown-sections";
import config from "#typedoc/typedoc.config";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readmePath = resolve(projectRoot, "README.md");
const assetsDirectory = resolve(projectRoot, "typedoc/assets");
const checkOnly = process.argv.includes("--check");

const GENERATED_FILE_NOTICE =
  "<!-- This file is auto-generated using TypeDoc. Do not edit README.md directly. -->";
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

const DUPLICATE_COMMENT_WARNING =
  "has multiple declarations with a comment. An arbitrary comment will be used";
const OPTIONS_PARAMETER_ROW_PATTERN = /^\| `options\??` \|/;
const OPTIONS_REFERENCE = "[`Options`](#options)";

const readAsset = (name: string): string =>
  readFileSync(resolve(assetsDirectory, name), "utf8")
    .trim()
    .replaceAll("{{RUST_VERSION}}", getRustVersionLabel());

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
    GENERATED_FILE_NOTICE,
    readAsset("header.md"),
    toc,
    ...renderedSections.map(({ markdown }) => markdown),
  ].join("\n\n")}\n`;
};

const assertOptionsParameterReference = (api: string): void => {
  const optionsRow = api
    .split("\n")
    .find((line) => OPTIONS_PARAMETER_ROW_PATTERN.test(line));

  if (!optionsRow?.includes(OPTIONS_REFERENCE)) {
    throw new Error(
      "TypeDoc expanded request options instead of linking to the Options section",
    );
  }
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
  assertOptionsParameterReference(generatedApi);
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
