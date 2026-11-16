import type { CallableTypeAliasSource } from "#typedoc/plugins/callableAliases";

export type CallableAliasRestoreState = {
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

export const updateCallableAliasState = (
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

export const getTypeScriptFenceMarker = (
  trimmed: string,
): string | undefined => {
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

export const findClosingFence = (
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

export type CallableFenceReplacement = {
  source: string;
  alias?: CallableTypeAliasSource;
};

export const getCallableFenceReplacement = (
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

export const recordCallableFenceReplacement = (
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
