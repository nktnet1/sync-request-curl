import { decodeQueryComponent } from "#/http/query/components";
import {
  compactQueryNode,
  mergeQueryNode,
  type QueryNode,
  type QueryObject,
} from "#/http/query/merge";
import { buildQueryNode, parseKeyPath } from "#/http/query/path";

const QUERY_PARAMETER_LIMIT = 1_000;
const objectPrototypeKeys = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

const isProtectedKey = (key: string): boolean =>
  key === "__proto__" || objectPrototypeKeys.has(key);

const parseQueryPart = (
  part: string,
): { rootKey: string; sourceValue: QueryNode } | undefined => {
  const equalsIndex = part.indexOf("=");
  const rawKey = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
  const rawValue = equalsIndex === -1 ? "" : part.slice(equalsIndex + 1);
  const path = parseKeyPath(decodeQueryComponent(rawKey));
  if (path.length === 0 || path.some(isProtectedKey)) return undefined;
  const rootKey = path[0] as string;
  const source = buildQueryNode(path, decodeQueryComponent(rawValue));
  return { rootKey, sourceValue: source[rootKey] as QueryNode };
};

export const parseQueryString = (query: string): Record<string, unknown> => {
  const parsed: QueryObject = Object.create(null);
  if (!query) return parsed;

  for (const part of query.split("&", QUERY_PARAMETER_LIMIT)) {
    const item = parseQueryPart(part);
    if (!item) continue;
    const { rootKey, sourceValue } = item;
    const current = parsed[rootKey];
    parsed[rootKey] =
      current === undefined
        ? sourceValue
        : mergeQueryNode(current, sourceValue);
  }
  return compactQueryNode(parsed) as QueryObject;
};
