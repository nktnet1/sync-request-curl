import type { QueryNode, QueryObject } from "#/http/query-merge";

const QUERY_DEPTH_LIMIT = 5;
const QUERY_ARRAY_INDEX_LIMIT = 20;

const isArrayIndex = (key: string): boolean =>
  /^\d+$/.test(key) && Number(key) <= QUERY_ARRAY_INDEX_LIMIT;

export const parseKeyPath = (key: string): string[] => {
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

export const buildQueryNode = (
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
