import { IncomingHttpHeaders } from 'http';
import { CurlCode, Easy } from 'node-libcurl';
import { HttpVerb, Options } from './types';
import { CurlError } from './errors';

interface RequestInputs {
  method: HttpVerb,
  url: string,
  options: Options;
}

/**
 * Handles query string parameters in a URL by modifying or appending them
 * based on the provided object.
 *
 * Arrays of primitives, e.g. { quizIds: [1,2,3] }, will be of the form:
 *   https://google.com.au/?quizIds%5B0%5D=0&quizIds%5B1%5D=1&quizIds%5B2%5D=2
 *   i.e. https://www.google.com.au/?quizIds[0]=0&quizIds[1]=1&quizIds[2]=2
 *
 * @param {string} url - The URL to handle query string parameters for.
 * @param {Object.<string, any>} qs - query string parameters to modify or append.
 * @returns {string} The modified URL with the updated query string parameters.
 */
export const handleQs = (url: string, qs: { [key: string]: any }): string => {
  const urlObj = new URL(url);
  for (const [key, value] of Object.entries(qs)) {
    if (Array.isArray(value)) {
      urlObj.searchParams.delete(key);
      value.forEach((item, i) => urlObj.searchParams.append(`${key}[${i}]`, String(item)));
    } else if (value === null) {
      urlObj.searchParams.set(key, '');
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
export const parseIncomingHeaders = (headers?: IncomingHttpHeaders): string[] => {
  return headers
    ? Object.entries(headers)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => value === '' ? `${key};` : `${key}: ${value}`)
    : [];
};

/**
 * Parses an array of header lines as IncomingHttpHeaders.
 *
 * @param {string[]} headerLines - An array of header lines to parse.
 * @returns {IncomingHttpHeaders} An object containing parsed headers.
 */
export const parseReturnedHeaders = (headerLines: string[]): IncomingHttpHeaders => {
  return headerLines.reduce((acc, header) => {
    const [name, ...values] = header.split(':');
    if (name && values.length > 0) {
      acc[name.trim().toLowerCase()] = values.join(':').trim();
    }
    return acc;
  }, {} as IncomingHttpHeaders);
};

/**
 * Checks CURL code and throws a `CurlError` if it indicates failure.
 *
 * @param {CurlCode} code - The CURL error code to check.
 * @param {RequestInputs} requestInputs - input parameters for the CURL request.
 * @throws {CurlError} Throws a `CurlError` if the CURL code indicates failure.
 */
export const checkValidCurlCode = (code: CurlCode, requestInputs: RequestInputs) => {
  if (code !== CurlCode.CURLE_OK) {
    throw new CurlError(code, `
      Curl request failed with code ${code}:
        - ${Easy.strError(code)}

      You can also look up the Libcurl Error (code ${code}) here:
        - https://curl.se/libcurl/c/libcurl-errors.html

      DEBUG: {
        method: "${requestInputs.method}",
        url: "${requestInputs.url}",
        options: ${JSON.stringify(requestInputs.options)}
      }
    `);
  }
};

/**
 * Checks the status code and body of an HTTP response
 *
 * @param {number} statusCode - The status code of the HTTP response.
 * @param {Buffer} body - The body of the HTTP response.
 * @throws {Error} if the status code is >= 300.
 */
export const checkGetBodyStatus = (statusCode: number, body: Buffer) => {
  if (statusCode >= 300) {
    throw new Error(`
      Server responded with status code ${statusCode}

      Body: ${body.toString()}

      Use 'res.body' instead of 'res.getBody()' to not have any errors thrown.
      The status code (in this case, ${statusCode}) can be checked manually
      with res.statusCode.
    `);
  }
};
