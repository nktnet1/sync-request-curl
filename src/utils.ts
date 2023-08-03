import { IncomingHttpHeaders } from 'http';
import { CurlCode } from 'node-libcurl';
import { HttpVerb, Options } from './types';

export const handleQs = (url: string, qs: { [key: string]: any }): string => {
  const urlObj = new URL(url);
  const queryParams = urlObj.searchParams;

  Object.entries(qs).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      queryParams.delete(key);
      value.forEach((item, i) => queryParams.append(`${key}[${i}]`, item.toString()));
    } else {
      queryParams.set(key, value.toString());
    }
  });

  urlObj.search = queryParams.toString();

  return urlObj.href;
};

export const parseHeaders = (headerLines: string[]): IncomingHttpHeaders => {
  return headerLines.reduce((acc, header) => {
    const [name, ...values] = header.split(':');
    if (name && values.length > 0) {
      acc[name.trim()] = values.join(':').trim();
    }
    return acc;
  }, {} as IncomingHttpHeaders);
};

export const checkValidCurlCode = (code: CurlCode, method: HttpVerb, url: string, options: Options) => {
  if (code !== CurlCode.CURLE_OK) {
    throw new Error(`
      Curl request failed with code ${code}
      Please look up libcurl error code!
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
