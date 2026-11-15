export interface QueryObject {
  [key: string]: QueryNode;
}

export type QueryNode = string | QueryNode[] | QueryObject;

const isObjectNode = (value: QueryNode): value is QueryObject | QueryNode[] =>
  typeof value === "object";

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

const mergePrimitiveSource = (target: QueryNode, source: string): QueryNode => {
  if (Array.isArray(target)) {
    target.push(source);
    return target;
  }
  return [target, source];
};

const mergeStructuredNodes = (
  target: QueryObject | QueryNode[],
  source: QueryObject | QueryNode[],
): QueryNode => {
  if (Array.isArray(target)) {
    return Array.isArray(source)
      ? mergeArrays(target, source)
      : mergeObjects(arrayToObject(target), source);
  }
  return mergeObjects(
    target,
    Array.isArray(source) ? arrayToObject(source) : source,
  );
};

export function mergeQueryNode(
  target: QueryNode,
  source: QueryNode,
): QueryNode {
  if (source === "" && isObjectNode(target)) return target;
  if (!isObjectNode(source)) return mergePrimitiveSource(target, source);
  if (!isObjectNode(target)) {
    return Array.isArray(source) ? [target, ...source] : [target, source];
  }
  return mergeStructuredNodes(target, source);
}

export const compactQueryNode = (value: QueryNode): QueryNode => {
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
