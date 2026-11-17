export interface TrustConfiguration {
  type: string;
  file?: string;
  repository?: string;
  environment?: string;
  permissions?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface JsonObjectScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

const advanceJsonObjectScan = (
  state: JsonObjectScanState,
  character: string,
): void => {
  if (state.inString) {
    if (state.escaped) state.escaped = false;
    else if (character === "\\") state.escaped = true;
    else if (character === '"') state.inString = false;
    return;
  }

  if (character === '"') state.inString = true;
  else if (character === "{") state.depth += 1;
  else if (character === "}") state.depth -= 1;
};

const findJsonObjectEnd = (input: string, start: number): number => {
  const state: JsonObjectScanState = {
    depth: 0,
    inString: false,
    escaped: false,
  };
  for (let index = start; index < input.length; index += 1) {
    advanceJsonObjectScan(state, input[index]);
    if (state.depth === 0) return index + 1;
  }
  throw new SyntaxError("Incomplete npm trust list JSON");
};

const skipJsonWhitespace = (input: string, start: number): number => {
  let index = start;
  while (index < input.length && /\s/.test(input[index])) index += 1;
  return index;
};

/** npm 11 can print adjacent JSON objects rather than a single JSON array. */
const parseAdjacentJsonObjects = (input: string): unknown[] => {
  const values: unknown[] = [];
  let index = 0;

  while (index < input.length) {
    index = skipJsonWhitespace(input, index);
    if (index === input.length) break;
    if (input[index] !== "{") {
      throw new SyntaxError("Invalid npm trust list JSON");
    }
    const end = findJsonObjectEnd(input, index);
    values.push(JSON.parse(input.slice(index, end)));
    index = end;
  }

  return values;
};

const isTrustConfiguration = (value: unknown): value is TrustConfiguration => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.permissions === undefined) return true;
  return (
    Array.isArray(value.permissions) &&
    value.permissions.every((permission) => typeof permission === "string")
  );
};

export const parseTrustedPublishers = (
  output: string,
): TrustConfiguration[] => {
  const input = output.trim();
  if (!input) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    parsed = parseAdjacentJsonObjects(input);
  }

  const configurations: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (!configurations.every(isTrustConfiguration)) {
    throw new TypeError("Unexpected npm trust list configuration format");
  }
  return configurations;
};
