import { domainToASCII } from "node:url";

const hasNonAscii = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i);
    if (code !== undefined && code > 0x7f) return true;
  }
  return false;
};

const isAsciiLetter = (code: number | undefined): boolean =>
  code !== undefined &&
  ((code >= 65 && code <= 90) || (code >= 97 && code <= 122));

const isAsciiDigit = (code: number | undefined): boolean =>
  code !== undefined && code >= 48 && code <= 57;

const schemePunctuation = new Set([43, 45, 46]);

const isSchemeCharacter = (code: number): boolean =>
  isAsciiLetter(code) || isAsciiDigit(code) || schemePunctuation.has(code);

const isDecimal = (value: string): boolean => /^\d*$/.test(value);

export interface AbsoluteUrlParts {
  prefix: string;
  authority: string;
  remainder: string;
}

const isValidUrlScheme = (url: string, schemeEnd: number): boolean => {
  if (schemeEnd <= 0 || !isAsciiLetter(url.codePointAt(0))) return false;
  for (let i = 1; i < schemeEnd; i += 1) {
    if (!isSchemeCharacter(url.charCodeAt(i))) return false;
  }
  return true;
};

const authorityEndIndex = (url: string, authorityStart: number): number => {
  for (let i = authorityStart; i < url.length; i += 1) {
    const code = url.codePointAt(i);
    if (code === 47 || code === 63 || code === 35) return i;
  }
  return url.length;
};

export const splitAbsoluteUrl = (url: string): AbsoluteUrlParts | undefined => {
  const schemeEnd = url.indexOf(":");
  if (!isValidUrlScheme(url, schemeEnd)) return undefined;

  // Preserve curl's one-, two-, and three-slash authority spellings.
  let authorityStart = schemeEnd + 1;
  while (url.charAt(authorityStart) === "/") authorityStart += 1;
  const slashCount = authorityStart - schemeEnd - 1;
  if (slashCount < 1 || slashCount > 3) return undefined;

  const authorityEnd = authorityEndIndex(url, authorityStart);
  return {
    prefix: url.slice(0, authorityStart),
    authority: url.slice(authorityStart, authorityEnd),
    remainder: url.slice(authorityEnd),
  };
};

const normalizeHostnameParts = (
  url: string,
  { prefix, authority, remainder }: AbsoluteUrlParts,
): string => {
  const userInfoEnd = authority.lastIndexOf("@");
  const userInfo = userInfoEnd >= 0 ? authority.slice(0, userInfoEnd + 1) : "";
  const hostAndPort = authority.slice(userInfoEnd + 1);
  if (hostAndPort.startsWith("[")) return url;

  const portSeparator = hostAndPort.lastIndexOf(":");
  const hasPort =
    portSeparator >= 0 && isDecimal(hostAndPort.slice(portSeparator + 1));
  const hostname = hasPort ? hostAndPort.slice(0, portSeparator) : hostAndPort;
  if (!hasNonAscii(hostname)) return url;

  const asciiHostname = domainToASCII(hostname);
  if (!asciiHostname) return url;

  const port = hasPort ? hostAndPort.slice(portSeparator) : "";
  return `${prefix}${userInfo}${asciiHostname}${port}${remainder}`;
};

/**
 * Convert only an internationalized hostname to ASCII/Punycode while leaving
 * all remaining URL bytes, including userinfo and path, unchanged.
 */
export const normalizeUrlHostname = (url: string): string => {
  const parts = hasNonAscii(url) ? splitAbsoluteUrl(url) : undefined;
  return parts ? normalizeHostnameParts(url, parts) : url;
};
