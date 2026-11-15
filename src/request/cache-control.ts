import type { NormalizedRequestHeaders } from "#/request/cache-types";
import { getRequestHeaderValue } from "#/request/cache-variants";

const splitCacheControlDirectives = (value: string): string[] => {
  const directives: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (quoted && character === "\\") {
      index += 1;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) {
      directives.push(value.slice(start, index));
      start = index + 1;
    }
  }
  directives.push(value.slice(start));
  return directives;
};

const parseCacheDirective = (
  rawDirective: string,
): { name: string; value: string } | undefined => {
  const directive = rawDirective.trim();
  if (!directive) return undefined;
  const equalsIndex = directive.indexOf("=");
  const rawName = equalsIndex < 0 ? directive : directive.slice(0, equalsIndex);
  const rawValue =
    equalsIndex < 0 ? "" : directive.slice(equalsIndex + 1).trim();
  return {
    name: rawName.trim().toLowerCase(),
    value:
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue,
  };
};

export const parseCacheControl = (
  value: string | undefined,
): Map<string, string> => {
  const directives = new Map<string, string>();
  if (!value) return directives;

  for (const rawDirective of splitCacheControlDirectives(value)) {
    const parsed = parseCacheDirective(rawDirective);
    if (parsed && !directives.has(parsed.name)) {
      directives.set(parsed.name, parsed.value);
    }
  }
  return directives;
};

export const parseDeltaSeconds = (
  value: string | undefined,
): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const parseAgeSeconds = (value: string | undefined): number => {
  if (value === undefined) return 0;
  const firstValue = value.split(",", 1)[0].trim();
  if (!/^\d+$/.test(firstValue)) return 0;
  // RFC 9111: use the first list member and saturate numeric overflow.
  // An oversized age must never make an ancient response appear new.
  return Math.min(Number(firstValue), Number.MAX_SAFE_INTEGER);
};

export const getRequestCacheControl = (
  requestHeaders: NormalizedRequestHeaders,
): Map<string, string> =>
  parseCacheControl(getRequestHeaderValue(requestHeaders, "cache-control"));

export const requestForcesRevalidation = (
  requestHeaders: NormalizedRequestHeaders,
): boolean => {
  const cacheControl = getRequestCacheControl(requestHeaders);
  if (cacheControl.has("no-cache")) {
    return true;
  }
  return (
    !getRequestHeaderValue(requestHeaders, "cache-control") &&
    getRequestHeaderValue(requestHeaders, "pragma")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "no-cache") === true
  );
};
