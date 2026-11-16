import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceDirectory = fileURLToPath(new URL("../../src", import.meta.url));

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

export type CallableTypeAliasSource = {
  declaration: string;
  callSignatures: string[];
};

export const collectCallableTypeAliases = (): ReadonlyMap<
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
