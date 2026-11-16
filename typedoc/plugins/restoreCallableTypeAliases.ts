import type { CallableTypeAliasSource } from "#typedoc/plugins/callableAliases";
import {
  type CallableAliasRestoreState,
  findClosingFence,
  getCallableFenceReplacement,
  getTypeScriptFenceMarker,
  recordCallableFenceReplacement,
  updateCallableAliasState,
} from "#typedoc/plugins/callableAliasFences";

export { getTypeScriptFenceMarker } from "#typedoc/plugins/callableAliasFences";

export const restoreCallableTypeAliases = (
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
