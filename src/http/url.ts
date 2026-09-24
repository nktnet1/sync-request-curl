import { domainToASCII } from "node:url";

const hasNonAscii = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    if ((value.codePointAt(i) ?? -1) > 0x7f) return true;
  }
  return false;
};

const isAsciiLetter = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

const isSchemeCharacter = (code: number): boolean =>
  isAsciiLetter(code) ||
  (code >= 48 && code <= 57) ||
  code === 43 ||
  code === 45 ||
  code === 46;

const isDecimal = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i) ?? -1;
    if (code < 48 || code > 57) return false;
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
  if (schemeEnd <= 0 || !isAsciiLetter(url.codePointAt(0) ?? -1)) {
    return undefined;
  }

  for (let i = 1; i < schemeEnd; i += 1) {
    if (!isSchemeCharacter(url.codePointAt(i) ?? -1)) return undefined;
  }

  const authorityStart = schemeEnd + 3;
  let authorityEnd = url.length;
  for (let i = authorityStart; i < url.length; i += 1) {
    const code = url.codePointAt(i) ?? -1;
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
  if (!hasNonAscii(url)) return url;

  const parts = splitAbsoluteUrl(url);
  if (!parts) return url;

  const { prefix, authority, remainder } = parts;
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

export const appendQueryString = (
  url: string,
  query: Record<string, unknown>,
): string => {
  const parsed = new URL(url);

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      parsed.searchParams.delete(key);
      value.forEach((item, index) => {
        parsed.searchParams.append(`${key}[${index}]`, String(item));
      });
    } else if (value === null) {
      parsed.searchParams.set(key, "");
    } else if (value !== undefined) {
      parsed.searchParams.set(key, String(value));
    }
  }

  parsed.search = parsed.searchParams.toString();
  return parsed.href;
};
