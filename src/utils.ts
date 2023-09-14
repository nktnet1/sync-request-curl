import { IncomingHttpHeaders } from 'http';
import { CurlCode } from 'node-libcurl';
import { HttpVerb, Options } from './types';
import { CurlError } from './errors';

export const handleQs = (url: string, qs: { [key: string]: any }): string => {
  const urlObj = new URL(url);
  Object.entries(qs).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      urlObj.searchParams.delete(key);
      value.forEach((item, i) => urlObj.searchParams.append(`${key}[${i}]`, String(item)));
    } else if (value === null) {
      urlObj.searchParams.set(key, '');
    } else if (value !== undefined) {
      urlObj.searchParams.set(key, String(value));
    }
  });
  urlObj.search = urlObj.searchParams.toString();
  return urlObj.href;
};

export const parseIncomingHeaders = (headers?: IncomingHttpHeaders): string[] => {
  return headers
    ? Object.entries(headers)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => value === '' ? `${key};` : `${key}: ${value}`)
    : [];
};

export const parseReturnedHeaders = (headerLines: string[]): IncomingHttpHeaders => {
  return headerLines.reduce((acc, header) => {
    const [name, ...values] = header.split(':');
    if (name && values.length > 0) {
      acc[name.trim().toLowerCase()] = values.join(':').trim();
    }
    return acc;
  }, {} as IncomingHttpHeaders);
};

export const checkValidCurlCode = (code: CurlCode, method: HttpVerb, url: string, options: Options) => {
  if (code !== CurlCode.CURLE_OK) {
    throw new CurlError(code, `
      Curl request failed with code ${code}.
      Please look up the Libcurl Error (code ${code}) here:
        - https://curl.se/libcurl/c/libcurl-errors.html

      DEBUG: {
        method: "${method}",
        url: "${url}",
        options: ${JSON.stringify(options)}
      }
    `);
  }
};

export const checkGetBodyStatus = (statusCode: number, body: Buffer) => {
  if (statusCode >= 300) {
    throw new Error(`
      Server responded with status code ${statusCode}

      Body: ${body.toString()}

      Use 'res.body' instead of 'res.getBody()' to not have any errors thrown.
      The status code (in this case, ${statusCode}) can be checked manually with res.statusCode.
    `);
  }
};
