import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";
import ts from "typescript";

const sourceDirectory = fileURLToPath(new URL("../../src", import.meta.url));

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

const walkTypeScriptSources = (directory: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypeScriptSources(path));
    } else if (entry.isFile() && extname(entry.name) === ".ts") {
      files.push(path);
    }
  }

  return files;
};

const isCallableTypeAlias = (node: ts.TypeAliasDeclaration): boolean =>
  ts.isFunctionTypeNode(node.type) ||
  (ts.isTypeLiteralNode(node.type) &&
    node.type.members.some((member) => ts.isCallSignatureDeclaration(member)));

type CallableTypeAliasSource = {
  declaration: string;
  callSignatures: string[];
};

const collectCallableTypeAliases = (): ReadonlyMap<
  string,
  CallableTypeAliasSource
> => {
  const declarations = new Map<string, CallableTypeAliasSource>();

  for (const fileName of walkTypeScriptSources(sourceDirectory)) {
    const sourceText = readFileSync(fileName, "utf8");
    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    for (const statement of sourceFile.statements) {
      if (
        !ts.isTypeAliasDeclaration(statement) ||
        !statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) ||
        !isCallableTypeAlias(statement)
      ) {
        continue;
      }

      declarations.set(statement.name.text, {
        declaration: statement.getText(sourceFile).replace(/^export\s+/, ""),
        callSignatures: ts.isTypeLiteralNode(statement.type)
          ? statement.type.members
              .filter(ts.isCallSignatureDeclaration)
              .map((member) => member.getText(sourceFile))
          : [],
      });
    }
  }

  return declarations;
};

type CallableAliasRestoreState = {
  activeAlias?: CallableTypeAliasSource;
  callSignatureIndex: number;
  expectCallSignature: boolean;
};

type MarkdownHeading = {
  level: number;
  title: string;
};

const getMarkdownHeading = (line: string): MarkdownHeading | undefined => {
  let level = 0;
  while (level < 6 && line[level] === "#") level += 1;

  if (level === 0 || line[level] !== " ") return undefined;
  return { level, title: line.slice(level + 1) };
};

const resetCallableAliasState = (state: CallableAliasRestoreState): void => {
  state.activeAlias = undefined;
  state.callSignatureIndex = 0;
  state.expectCallSignature = false;
};

const updateCallableAliasState = (
  state: CallableAliasRestoreState,
  trimmed: string,
): void => {
  const heading = getMarkdownHeading(trimmed);
  if (trimmed === "***" || heading?.level === 3) {
    resetCallableAliasState(state);
    return;
  }

  if (heading?.title === "Call Signature") {
    state.expectCallSignature = true;
  }
};

const getTypeScriptFenceMarker = (trimmed: string): string | undefined => {
  if (trimmed.startsWith("```ts")) return "```";
  if (trimmed.startsWith("~~~ts")) return "~~~";
  return undefined;
};

const getTypeAliasName = (line: string | undefined): string | undefined => {
  const prefix = "type ";
  if (!line?.startsWith(prefix)) return undefined;

  const declaration = line.slice(prefix.length);
  let end = 0;
  while (end < declaration.length) {
    const character = declaration[end];
    if (
      character === " " ||
      character === "\t" ||
      character === "<" ||
      character === "="
    ) {
      break;
    }
    end += 1;
  }

  return end === 0 ? undefined : declaration.slice(0, end);
};

const findClosingFence = (
  lines: readonly string[],
  startIndex: number,
  fenceMarker: string,
): number | undefined => {
  let index = startIndex;
  while (index < lines.length) {
    if ((lines[index] ?? "").trimStart().startsWith(fenceMarker)) {
      return index;
    }
    index += 1;
  }
  return undefined;
};

type CallableFenceReplacement = {
  source: string;
  alias?: CallableTypeAliasSource;
};

const getCallableFenceReplacement = (
  lines: readonly string[],
  index: number,
  declarations: ReadonlyMap<string, CallableTypeAliasSource>,
  state: CallableAliasRestoreState,
): CallableFenceReplacement | undefined => {
  const aliasName = getTypeAliasName(lines[index + 1]);
  const alias = aliasName ? declarations.get(aliasName) : undefined;
  if (alias) return { source: alias.declaration, alias };

  if (!state.expectCallSignature || !state.activeAlias) return undefined;
  const source = state.activeAlias.callSignatures[state.callSignatureIndex];
  return source ? { source } : undefined;
};

const recordCallableFenceReplacement = (
  state: CallableAliasRestoreState,
  replacement: CallableFenceReplacement,
): void => {
  if (replacement.alias) {
    state.activeAlias = replacement.alias;
    state.callSignatureIndex = 0;
    return;
  }

  state.callSignatureIndex += 1;
  state.expectCallSignature = false;
};

const restoreCallableTypeAliases = (
  lines: string[],
  declarations: ReadonlyMap<string, CallableTypeAliasSource>,
): string[] => {
  const output: string[] = [];
  const state: CallableAliasRestoreState = {
    callSignatureIndex: 0,
    expectCallSignature: false,
  };
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trimStart();
    updateCallableAliasState(state, trimmed);

    const fenceMarker = getTypeScriptFenceMarker(trimmed);
    if (!fenceMarker) {
      output.push(line);
      index += 1;
      continue;
    }

    const replacement = getCallableFenceReplacement(
      lines,
      index,
      declarations,
      state,
    );
    if (!replacement) {
      output.push(line);
      index += 1;
      continue;
    }

    const closingIndex = findClosingFence(lines, index + 1, fenceMarker);
    if (closingIndex === undefined) {
      output.push(line);
      index += 1;
      continue;
    }

    output.push(
      line,
      ...replacement.source.split("\n"),
      lines[closingIndex] ?? "",
    );
    recordCallableFenceReplacement(state, replacement);
    index = closingIndex + 1;
  }

  return output;
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
