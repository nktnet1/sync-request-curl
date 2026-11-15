import { URL } from "node:url";
import { splitAbsoluteUrl } from "#/http/url-authority";

export { normalizeUrlHostname, splitAbsoluteUrl } from "#/http/url-authority";

import * as v from "valibot";
import { CurlError } from "#/errors";
import { parseQueryString, stringifyQuery } from "#/http/query-string";
import { parseSchema } from "#/validate";

/** Userinfo can enable Basic authentication even when both fields are empty. */
export const hasUrlCredentials = (url: string): boolean => {
  const parts = splitAbsoluteUrl(url);
  if (parts) return parts.authority.includes("@");
  const parsed = new URL(url);
  return parsed.username !== "" || parsed.password !== "";
};

/** Remove userinfo without normalizing a libcurl-compatible absolute URL. */
export const stripUrlCredentials = (url: string): string => {
  const parts = splitAbsoluteUrl(url);
  if (!parts) {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  }

  const userInfoEnd = parts.authority.lastIndexOf("@");
  return userInfoEnd < 0
    ? url
    : `${parts.prefix}${parts.authority.slice(userInfoEnd + 1)}${parts.remainder}`;
};

const hasAmbiguousHttpAuthority = (url: string): boolean => {
  // WHATWG treats a backslash as a slash; libcurl can treat it as userinfo.
  // Include nonstandard slash counts without changing the path or query.
  const authority = url
    .slice(url.indexOf(":") + 1)
    .replace(/^\/+/, "")
    .split(/[/?#]/, 1)[0];
  return authority.includes("\\");
};

export const assertSupportedHttpUrl = (url: string): void => {
  // WHATWG removes some controls and trims surrounding whitespace; native
  // C strings can also truncate at NUL. Reject before either normalization
  // or cache lookup can conceal the malformed input.
  for (const character of url) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 0x20 || code === 0x7f)) {
      throw new CurlError(
        3,
        "Request failed: URL contains an unescaped space or control character",
      );
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CurlError(
      3,
      "Request failed: URL using bad/illegal format or missing URL",
    );
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (hasAmbiguousHttpAuthority(url)) {
      throw new CurlError(
        3,
        "Request failed: URL contains an ambiguous authority",
      );
    }
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

export const appendQueryString = (
  url: string,
  query: Record<string, unknown>,
): string => {
  const parsedQuery = parseSchema(plainObjectSchema, query);
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
    parseQueryString(existingQuery),
    parsedQuery,
  );
  const serialised = stringifyQuery(merged);
  const queryString = serialised ? `?${serialised}` : "";

  return `${base}${queryString}${fragment}`;
};
