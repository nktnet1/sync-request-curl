const QUERY_DEPTH_LIMIT = 5;
const QUERY_PARAMETER_LIMIT = 1_000;
const QUERY_ARRAY_INDEX_LIMIT = 20;

interface QueryObject {
  [key: string]: QueryNode;
}

type QueryNode = string | QueryNode[] | QueryObject;

const objectPrototypeKeys = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

const isObjectNode = (value: QueryNode): value is QueryObject | QueryNode[] =>
  typeof value === "object";

const isProtectedKey = (key: string): boolean =>
  key === "__proto__" || objectPrototypeKeys.has(key);

const decodeQueryComponent = (value: string): string => {
  const normalized = value.replaceAll("+", " ");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
};

const textEncoder = new TextEncoder();

const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

const isUnreservedByte = (byte: number): boolean =>
  UNRESERVED.includes(String.fromCodePoint(byte));

const encodeQueryComponent = (value: string): string => {
  let encoded = "";
  for (const byte of textEncoder.encode(value)) {
    encoded += isUnreservedByte(byte)
      ? String.fromCodePoint(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
};

const isArrayIndex = (key: string): boolean =>
  /^\d+$/.test(key) && Number(key) <= QUERY_ARRAY_INDEX_LIMIT;

const parseKeyPath = (key: string): string[] => {
  const firstBracket = key.indexOf("[");
  if (firstBracket === -1) {
    return key ? [key] : [];
  }

  const path: string[] = [];
  const parent = key.slice(0, firstBracket);
  if (parent) {
    path.push(parent);
  }

  let cursor = firstBracket;
  let depth = 0;
  while (
    cursor < key.length &&
    key[cursor] === "[" &&
    depth < QUERY_DEPTH_LIMIT
  ) {
    const closingBracket = key.indexOf("]", cursor + 1);
    if (closingBracket === -1) {
      break;
    }

    path.push(key.slice(cursor + 1, closingBracket));
    cursor = closingBracket + 1;
    depth += 1;
  }

  if (cursor < key.length) {
    path.push(key.slice(cursor));
  }

  return path;
};

const buildQueryNode = (
  path: readonly string[],
  value: string,
): QueryObject => {
  let node: QueryNode = value;

  for (let index = path.length - 1; index >= 0; index -= 1) {
    const key = path[index] as string;
    if (index > 0 && key === "") {
      node = [node];
      continue;
    }

    if (index > 0 && isArrayIndex(key)) {
      const array: QueryNode[] = [];
      array[Number(key)] = node;
      node = array;
      continue;
    }

    const object: QueryObject = Object.create(null);
    object[key] = node;
    node = object;
  }

  return node as QueryObject;
};

const arrayToObject = (array: QueryNode[]): QueryObject => {
  const object: QueryObject = Object.create(null);
  for (const key of Object.keys(array)) {
    object[key] = array[Number(key)] as QueryNode;
  }
  return object;
};

function mergeArrays(target: QueryNode[], source: QueryNode[]): QueryNode[] {
  for (const key of Object.keys(source)) {
    const index = Number(key);
    const sourceValue = source[index] as QueryNode;
    const targetValue = target[index];
    if (targetValue === undefined) {
      target[index] = sourceValue;
    } else if (isObjectNode(targetValue) && isObjectNode(sourceValue)) {
      target[index] = mergeQueryNode(targetValue, sourceValue);
    } else {
      target.push(sourceValue);
    }
  }
  return target;
}

function mergeObjects(target: QueryObject, source: QueryObject): QueryObject {
  for (const key of Object.keys(source)) {
    const sourceValue = source[key] as QueryNode;
    const targetValue = target[key];
    target[key] =
      targetValue === undefined
        ? sourceValue
        : mergeQueryNode(targetValue, sourceValue);
  }
  return target;
}

function mergeQueryNode(target: QueryNode, source: QueryNode): QueryNode {
  if (source === "" && isObjectNode(target)) {
    return target;
  }
  if (!isObjectNode(source)) {
    if (Array.isArray(target)) {
      target.push(source);
      return target;
    }
    return [target, source];
  }
  if (!isObjectNode(target)) {
    return Array.isArray(source) ? [target, ...source] : [target, source];
  }
  if (Array.isArray(target)) {
    return Array.isArray(source)
      ? mergeArrays(target, source)
      : mergeObjects(arrayToObject(target), source);
  }
  if (Array.isArray(source)) {
    return mergeObjects(target, arrayToObject(source));
  }
  return mergeObjects(target, source);
}

const compactQueryNode = (value: QueryNode): QueryNode => {
  if (Array.isArray(value)) {
    const compacted: QueryNode[] = [];
    for (const key of Object.keys(value)) {
      compacted.push(compactQueryNode(value[Number(key)] as QueryNode));
    }
    return compacted;
  }

  if (typeof value !== "object") {
    return value;
  }

  for (const key of Object.keys(value)) {
    value[key] = compactQueryNode(value[key] as QueryNode);
  }
  return value;
};

export const parseQueryString = (query: string): Record<string, unknown> => {
  const parsed: QueryObject = Object.create(null);
  if (!query) {
    return parsed;
  }

  for (const part of query.split("&", QUERY_PARAMETER_LIMIT)) {
    const equalsIndex = part.indexOf("=");
    const rawKey = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
    const rawValue = equalsIndex === -1 ? "" : part.slice(equalsIndex + 1);
    const key = decodeQueryComponent(rawKey);
    const path = parseKeyPath(key);

    if (path.length === 0 || path.some(isProtectedKey)) {
      continue;
    }

    const source = buildQueryNode(path, decodeQueryComponent(rawValue));
    const rootKey = path[0] as string;
    const sourceValue = source[rootKey] as QueryNode;
    const current = parsed[rootKey];
    parsed[rootKey] =
      current === undefined
        ? sourceValue
        : mergeQueryNode(current, sourceValue);
  }

  return compactQueryNode(parsed) as QueryObject;
};

const primitiveToString = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    const buffer: Buffer = value;
    return buffer.toString("utf8");
  }

  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
    case "function":
      return value.toString();
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
