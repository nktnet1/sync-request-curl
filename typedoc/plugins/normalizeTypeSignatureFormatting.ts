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

const restoreCallableTypeAliases = (
  lines: string[],
  declarations: ReadonlyMap<string, CallableTypeAliasSource>,
): string[] => {
  const output: string[] = [];
  let activeAlias: CallableTypeAliasSource | undefined;
  let callSignatureIndex = 0;
  let expectCallSignature = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trimStart();

    if (trimmed === "***" || /^####\s/.test(trimmed)) {
      activeAlias = undefined;
      callSignatureIndex = 0;
      expectCallSignature = false;
    } else if (/^#{1,6}\s+Call Signature$/.test(trimmed)) {
      expectCallSignature = true;
    }
    if (!trimmed.startsWith("```ts") && !trimmed.startsWith("~~~ts")) {
      output.push(line);
      continue;
    }

    const fenceMarker = trimmed.slice(0, 3);
    const firstCodeLine = lines[index + 1];
    const aliasName = firstCodeLine?.match(
      /^type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*=/,
    )?.[1];
    const alias = aliasName ? declarations.get(aliasName) : undefined;
    const callSignature = expectCallSignature
      ? activeAlias?.callSignatures[callSignatureIndex]
      : undefined;

    if (!alias && !callSignature) {
      output.push(line);
      continue;
    }

    let closingIndex = index + 1;
    while (
      closingIndex < lines.length &&
      !(lines[closingIndex] ?? "").trimStart().startsWith(fenceMarker)
    ) {
      closingIndex += 1;
    }

    if (closingIndex >= lines.length) {
      output.push(line);
      continue;
    }

    const replacement = alias?.declaration ?? callSignature;
    if (!replacement) {
      output.push(line);
      continue;
    }

    output.push(line, ...replacement.split("\n"), lines[closingIndex] ?? "");
    index = closingIndex;

    if (alias) {
      activeAlias = alias;
      callSignatureIndex = 0;
    } else {
      callSignatureIndex += 1;
      expectCallSignature = false;
    }
  }

  return output;
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
    let inTypeScriptFence = false;
    let fenceMarker = "";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const trimmed = line.trimStart();

      if (!inTypeScriptFence) {
        if (trimmed.startsWith("```ts") || trimmed.startsWith("~~~ts")) {
          inTypeScriptFence = true;
          fenceMarker = trimmed.slice(0, 3);
        }
        continue;
      }

      if (trimmed.startsWith(fenceMarker)) {
        inTypeScriptFence = false;
        fenceMarker = "";
        continue;
      }

      lines[index] = normalizeTypeScriptLine(line);
      groupLeadingUnionIntersection(lines, index);
    }

    page.contents = lines.join("\n");
  });
}
