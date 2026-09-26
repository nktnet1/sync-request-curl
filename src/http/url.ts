import { domainToASCII, URL } from "node:url";
import qs from "qs";
import * as v from "valibot";

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

export const assertSupportedHttpUrl = (url: string): void => {
  const parsed = new URL(url);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return;
  }

  const protocol = parsed.protocol.replace(/:$/, "");
  throw new TypeError(
    `The protocol "${protocol}" is not supported, cannot load "${url}"`,
  );
};

const recordSchema = v.record(v.string(), v.unknown());
const plainObjectSchema = v.custom<v.InferOutput<typeof recordSchema>>(
  (input) => {
    if (!v.is(recordSchema, input)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
  },
  "Expected a plain object",
);

// `then-request` delegates `options.qs` to `qs` with its default parser and
// serializer options. Use the same library directly so parsing, merging,
// encoding, depth limits, and array handling stay aligned upstream.
export const appendQueryString = (
  url: string,
  query: Record<string, unknown>,
): string => {
  const parsedQuery = v.parse(plainObjectSchema, query);
  const fragmentIndex = url.indexOf("#");
  const fragment = fragmentIndex === -1 ? "" : url.slice(fragmentIndex);
  const withoutFragment =
    fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf("?");
  const base =
    queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
  const existingQuery =
    queryIndex === -1 ? "" : withoutFragment.slice(queryIndex + 1);
  const merged: Record<string, unknown> = Object.assign(
    Object.create(null),
    qs.parse(existingQuery),
    parsedQuery,
  );
  const serialised = qs.stringify(merged);
  const queryString = serialised ? `?${serialised}` : "";

  return `${base}${queryString}${fragment}`;
};
