import { domainToASCII, URL, type URLSearchParams } from "node:url";

const hasNonAscii = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i);
    if (code !== undefined && code > 0x7f) {
      return true;
    }
  }
  return false;
};

const isAsciiLetter = (code: number | undefined): boolean =>
  code !== undefined &&
  ((code >= 65 && code <= 90) || (code >= 97 && code <= 122));

const isSchemeCharacter = (code: number | undefined): boolean =>
  code !== undefined &&
  (isAsciiLetter(code) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 45 ||
    code === 46);

const isDecimal = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i);
    if (code === undefined || code < 48 || code > 57) {
      return false;
    }
  }
  return true;
};

interface AbsoluteUrlParts {
  prefix: string;
  authority: string;
  remainder: string;
}

const splitAbsoluteUrl = (url: string): AbsoluteUrlParts | undefined => {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd <= 0 || !isAsciiLetter(url.codePointAt(0))) {
    return undefined;
  }

  for (let i = 1; i < schemeEnd; i += 1) {
    if (!isSchemeCharacter(url.codePointAt(i))) {
      return undefined;
    }
  }

  const authorityStart = schemeEnd + 3;
  let authorityEnd = url.length;
  for (let i = authorityStart; i < url.length; i += 1) {
    const code = url.codePointAt(i);
    if (code === 47 || code === 63 || code === 35) {
      authorityEnd = i;
      break;
    }
  }

  return {
    prefix: url.slice(0, authorityStart),
    authority: url.slice(authorityStart, authorityEnd),
    remainder: url.slice(authorityEnd),
  };
};

/**
 * Converts only an internationalized hostname to ASCII/Punycode while leaving
 * the rest of the URL byte-for-byte unchanged.
 */
export const normalizeUrlHostname = (url: string): string => {
  if (!hasNonAscii(url)) {
    return url;
  }

  const parts = splitAbsoluteUrl(url);
  if (!parts) {
    return url;
  }

  const { prefix, authority, remainder } = parts;
  const userInfoEnd = authority.lastIndexOf("@");
  const userInfo = userInfoEnd >= 0 ? authority.slice(0, userInfoEnd + 1) : "";
  const hostAndPort = authority.slice(userInfoEnd + 1);

  if (hostAndPort.startsWith("[")) {
    return url;
  }

  const portSeparator = hostAndPort.lastIndexOf(":");
  const hasPort =
    portSeparator >= 0 && isDecimal(hostAndPort.slice(portSeparator + 1));
  const hostname = hasPort ? hostAndPort.slice(0, portSeparator) : hostAndPort;

  if (!hasNonAscii(hostname)) {
    return url;
  }

  const asciiHostname = domainToASCII(hostname);
  if (!asciiHostname) {
    return url;
  }

  const port = hasPort ? hostAndPort.slice(portSeparator) : "";
  return `${prefix}${userInfo}${asciiHostname}${port}${remainder}`;
};

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const deleteQueryValue = (searchParams: URLSearchParams, key: string): void => {
  const keysToDelete = new Set<string>();
  for (const existingKey of searchParams.keys()) {
    if (existingKey === key || existingKey.startsWith(`${key}[`)) {
      keysToDelete.add(existingKey);
    }
  }
  for (const existingKey of keysToDelete) {
    searchParams.delete(existingKey);
  }
};

const appendQueryValue = (
  searchParams: URLSearchParams,
  key: string,
  value: unknown,
  ancestors: Set<object>,
): void => {
  if (value === undefined) {
    return;
  }

  if (value === null) {
    searchParams.append(key, "");
    return;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      searchParams.append(key, String(value));
      return;
    case "object":
      break;
    default:
      throw new TypeError(
        `Unsupported query-string value for "${key}": ${typeof value}`,
      );
  }

  if (value instanceof Date) {
    searchParams.append(key, value.toISOString());
    return;
  }

  if (ancestors.has(value)) {
    throw new TypeError(
      `Cannot serialize circular query-string value at "${key}"`,
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        appendQueryValue(searchParams, `${key}[${index}]`, item, ancestors);
      });
      return;
    }

    if (!isPlainObject(value)) {
      throw new TypeError(`Unsupported query-string object for "${key}"`);
    }

    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      appendQueryValue(
        searchParams,
        `${key}[${nestedKey}]`,
        nestedValue,
        ancestors,
      );
    }
  } finally {
    ancestors.delete(value);
  }
};

export const appendQueryString = (
  url: string,
  query: Record<string, unknown>,
): string => {
  const parsed = new URL(url);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    deleteQueryValue(parsed.searchParams, key);
    appendQueryValue(parsed.searchParams, key, value, new Set());
  }

  parsed.search = parsed.searchParams.toString();
  return parsed.href;
};
