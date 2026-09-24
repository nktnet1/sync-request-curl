import { domainToASCII } from "node:url";
import type { IncomingHttpHeaders } from "http";
import { CurlError } from "#/errors";
import type { HttpVerb, Options } from "#/types";

interface RequestInputs {
  method: HttpVerb;
  url: string;
  options: Options;
}

const nonAscii = /\P{ASCII}/u;
const absoluteUrl =
  /^([A-Za-z][A-Za-z\d+.-]*:\/\/)([^/?#]*)([/?#][\s\S]*)?$/;

/**
 * Converts only an internationalized hostname to ASCII/Punycode while leaving
 * the rest of the URL byte-for-byte unchanged. The vendored curl-sys build
 * does not enable libcurl's optional IDN backend.
 */
export const normalizeUrlHostname = (url: string): string => {
  if (!nonAscii.test(url)) {
    return url;
  }

  const match = absoluteUrl.exec(url);
  if (!match) {
    return url;
  }

  const [, scheme, authority, remainder = ""] = match;
  const userInfoEnd = authority.lastIndexOf("@");
  const userInfo = userInfoEnd >= 0 ? authority.slice(0, userInfoEnd + 1) : "";
  const hostAndPort = authority.slice(userInfoEnd + 1);

  // IPv6 literals are already ASCII and use colons as part of the address.
  if (hostAndPort.startsWith("[")) {
    return url;
  }

  const portSeparator = hostAndPort.lastIndexOf(":");
  const hasPort =
    portSeparator >= 0 && /^\d*$/.test(hostAndPort.slice(portSeparator + 1));
  const hostname = hasPort ? hostAndPort.slice(0, portSeparator) : hostAndPort;

  if (!nonAscii.test(hostname)) {
    return url;
  }

  const asciiHostname = domainToASCII(hostname);
  if (!asciiHostname) {
    // Preserve existing libcurl error behaviour for malformed hostnames.
    return url;
  }

  const port = hasPort ? hostAndPort.slice(portSeparator) : "";
  return `${scheme}${userInfo}${asciiHostname}${port}${remainder}`;
};

/**
 * Handles query string parameters in a URL by modifying or appending them
 * based on the provided object.
 *
 * Arrays of primitives, e.g. { quizIds: [1,2,3] }, will be of the form:
 *   https://google.com.au/?quizIds%5B0%5D=1&quizIds%5B1%5D=2&quizIds%5B2%5D=3
 *   i.e. https://www.google.com.au/?quizIds[0]=1&quizIds[1]=2&quizIds[2]=3
 *
 * @param {string} url - The URL to handle query string parameters for.
 * @param {Object.<string, any>} qs - query string parameters to modify or append.
 * @returns {string} The modified URL with the updated query string parameters.
 */
export const handleQs = (
  url: string,
  qs: { [key: string]: unknown },
): string => {
  const urlObj = new URL(url);
  for (const [key, value] of Object.entries(qs)) {
    if (Array.isArray(value)) {
      urlObj.searchParams.delete(key);
      value.forEach((item, i) => {
        /* v8 ignore next */
        urlObj.searchParams.append(`${key}[${i}]`, String(item));
      });
    } else if (value === null) {
      urlObj.searchParams.set(key, "");
    } else if (value !== undefined) {
      urlObj.searchParams.set(key, String(value));
    }
  }
  urlObj.search = urlObj.searchParams.toString();
  return urlObj.href;
};

/**
 * Parses incoming HTTP headers to an array of formatted strings.
 *
 * @param {IncomingHttpHeaders} headers - The header object to parse.
 * @returns {string[]} An array of formatted header strings.
 */
export const parseIncomingHeaders = (
  headers?: IncomingHttpHeaders,
): string[] => {
  return headers
    ? Object.entries(headers)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => (value === "" ? `${key};` : `${key}: ${value}`))
    : [];
};

/**
 * Parses the final HTTP response header block as IncomingHttpHeaders.
 * Repeated headers are preserved as arrays.
 *
 * @param {string[]} headerLines - An array of header lines to parse.
 * @returns {IncomingHttpHeaders} An object containing parsed headers.
 */
export const parseReturnedHeaders = (
  headerLines: string[],
): IncomingHttpHeaders => {
  const finalStatusLineIndex = headerLines.findLastIndex((header) =>
    /^HTTP\/\d(?:\.\d+)?\s+\d{3}\b/i.test(header),
  );
  const finalHeaderLines =
    finalStatusLineIndex >= 0
      ? headerLines.slice(finalStatusLineIndex + 1)
      : headerLines;

  return finalHeaderLines.reduce((acc, header) => {
    const separatorIndex = header.indexOf(":");
    if (separatorIndex <= 0) {
      return acc;
    }

    const name = header.slice(0, separatorIndex).trim().toLowerCase();
    const value = header.slice(separatorIndex + 1).trim();
    const existingValue = acc[name];

    if (existingValue === undefined) {
      acc[name] = value;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      acc[name] = [existingValue, value];
    }

    return acc;
  }, {} as IncomingHttpHeaders);
};

/**
 * Checks a libcurl code and throws a `CurlError` if it indicates failure.
 *
 * @param {number} code - The libcurl error code to check.
 * @param {string} errorMessage - The libcurl error string.
 * @param {RequestInputs} requestInputs - input parameters for the request.
 * @throws {CurlError} Throws a `CurlError` if the libcurl code indicates failure.
 */
export const checkValidCurlCode = (
  code: number,
  errorMessage: string,
  requestInputs: RequestInputs,
): void => {
  if (code !== 0) {
    const debugDetails = requestInputs.options.debug
      ? `

      DEBUG: {
        method: "${requestInputs.method}",
        url: "${requestInputs.url}",
        options: ${JSON.stringify(requestInputs.options)}
      }`
      : "";

    throw new CurlError(
      code,
      `
      Curl request failed with code ${code}:
        - ${errorMessage}

      You can also look up the Libcurl Error (code ${code}) here:
        - https://curl.se/libcurl/c/libcurl-errors.html${debugDetails}
    `,
    );
  }
};

/**
 * Checks the status code and body of an HTTP response
 *
 * @param {number} statusCode - The status code of the HTTP response.
 * @param {Buffer} body - The body of the HTTP response.
 * @throws {Error} if the status code is >= 300.
 */
export const checkValidStatusCode = (statusCode: number, body: Buffer) => {
  if (statusCode >= 300) {
    throw new Error(`
Server responded with status code
  ${statusCode}

Body:
  ${body.toString()}

Use 'res.body' instead of 'res.getBody()' to not have any errors thrown.

The status code (in this case, ${statusCode}) can be checked manually
with res.statusCode.
    `);
  }
};
