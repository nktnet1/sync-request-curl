// const request = require('sync-curl');
import { Curl, CurlCode, Easy } from 'node-libcurl';
import { HttpVerb, Options, Response, BufferEncoding } from './types';
import { generateQueryString, parseHeaders } from './utils';

export const request = (method: HttpVerb, url: string, options: Options = {}): Response => {
  const curl = new Easy();
  curl.setOpt(Curl.option.CUSTOMREQUEST, method);
  curl.setOpt(Curl.option.TIMEOUT, options.timeout || false);

  // ======================================================================= //
  // Handle query string
  // ==========================//

  if (options.qs && Object.keys(options.qs).length > 0) {
    curl.setOpt(Curl.option.URL, `${url}?${generateQueryString(options.qs)}`);
  } else {
    curl.setOpt(Curl.option.URL, url);
  }

  // ======================================================================= //
  // Handle headers
  // ==========================//

  // Incoming headers
  const httpHeaders: string[] = [];
  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => httpHeaders.push(`${key}: ${value}`));
  }

  // Response headers
  const returnedHeaderArray: string[] = [];
  curl.setOpt(Curl.option.HEADERFUNCTION, (headerLine) => {
    returnedHeaderArray.push(headerLine.toString('utf-8').trim());
    return headerLine.length;
  });

  // ======================================================================= //
  // Handle JSON/body
  // ==========================//

  if (options.json) {
    httpHeaders.push('Content-Type: application/json');
    curl.setOpt(Curl.option.POSTFIELDS, JSON.stringify(options.json));
  } else if (options.body) {
    curl.setOpt(Curl.option.POSTFIELDS, String(options.body));
  }
  let body = Buffer.alloc(0);
  curl.setOpt(Curl.option.WRITEFUNCTION, (buff, nmemb, size) => {
    body = Buffer.concat([body, buff.slice(0, nmemb * size)]);
    return nmemb * size;
  });

  // ======================================================================= //
  // Execute request
  // ==========================//

  curl.setOpt(Curl.option.HTTPHEADER, httpHeaders);
  const code = curl.perform();

  // ======================================================================= //
  // Error handling
  // ==========================//

  if (code !== CurlCode.CURLE_OK) {
    throw new Error(`This shouldn't happen :(. Curl request failed with code: ${code}`);
  }
  const statusCode = curl.getInfo('RESPONSE_CODE').data;
  if (typeof statusCode !== 'number') {
    throw new Error(`Status code ${statusCode} is not of type number!`);
  }

  // ======================================================================= //
  // Finalising return
  // ==========================//

  const headers = parseHeaders(returnedHeaderArray);

  const getBody = (encoding?: BufferEncoding): string | Buffer => {
    if (statusCode >= 300) {
      throw new Error(`Server responded with status code ${statusCode}\n${body.toString()}\nUse 'res.body' instead of 'res.getBody()' to not have any errors thrown.`);
    }
    return encoding ? body.toString(encoding) : body;
  };

  // ======================================================================= //
  // Finish
  // ==========================//

  curl.close();
  return { statusCode, body, getBody, headers };
};
