import { encodeQueryComponent } from "#/http/query/components";

const primitiveToString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return value === null ? "" : undefined;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("utf8");

  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
    case "function":
      return String(value);
    default:
      return undefined;
  }
};

const appendStringifiedValue = (
  pairs: string[],
  key: string,
  value: unknown,
  ancestors: Set<object>,
): void => {
  const primitive = primitiveToString(value);
  if (primitive !== undefined) {
    pairs.push(
      `${encodeQueryComponent(key)}=${encodeQueryComponent(primitive)}`,
    );
    return;
  }
  if (value === undefined) {
    return;
  }

  const object = value as object;
  if (ancestors.has(object)) {
    throw new RangeError("Cyclic object value");
  }

  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        appendStringifiedValue(pairs, `${key}[${index}]`, item, ancestors);
      });
      return;
    }

    for (const nestedKey of Object.keys(object)) {
      appendStringifiedValue(
        pairs,
        `${key}[${nestedKey}]`,
        (value as Record<string, unknown>)[nestedKey],
        ancestors,
      );
    }
  } finally {
    ancestors.delete(object);
  }
};

export const stringifyQuery = (query: Record<string, unknown>): string => {
  const pairs: string[] = [];
  for (const key of Object.keys(query)) {
    appendStringifiedValue(pairs, key, query[key], new Set());
  }
  return pairs.join("&");
};
