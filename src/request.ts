import { Curl, CurlCode, Easy } from 'node-libcurl';
import { HttpVerb, Options, Response, GetBody } from './types';
import { handleQs, parseHeaders } from './utils';

const request = (method: HttpVerb, url: string, options: Options = {}): Response => {
  const curl = new Easy();
  curl.setOpt(Curl.option.CUSTOMREQUEST, method);
  curl.setOpt(Curl.option.TIMEOUT, options.timeout || false);
  curl.setOpt(Curl.option.FOLLOWLOCATION, options.followRedirects || false);
  curl.setOpt(Curl.option.MAXREDIRS, options.maxRedirects || Number.MAX_SAFE_INTEGER);

  // ======================================================================= //
  // Handle query string
  // ==========================//

  url = options.qs && Object.keys(options.qs).length ? handleQs(url, options.qs) : url;
  curl.setOpt(Curl.option.URL, url);

  // ======================================================================= //
  // Handle headers
  // ==========================//

  // Incoming headers
  const httpHeaders: string[] = options.headers
    ? Object.entries(options.headers)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => value === '' ? `${key};` : `${key}: ${value}`)
    : [];

  // Outgoing headers
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

  // ======================================================================= //
  // Finalising return
  // ==========================//

  const statusCode = curl.getInfo('RESPONSE_CODE').data;

  /* istanbul ignore next */
  if (typeof statusCode !== 'number' || isNaN(statusCode)) {
    throw new Error(`Status code ${statusCode} is either NaN or not of type number! Type: ${typeof statusCode}`);
  }

  const headers = parseHeaders(returnedHeaderArray);

  const getBody: GetBody = (encoding?) => {
    if (statusCode >= 300) {
      throw new Error(`
        Server responded with status code ${statusCode}

        Body: ${body.toString()}

        Use 'res.body' instead of 'res.getBody()' to not have any errors thrown.
        The status code (in this case, ${statusCode}) can be checked manually with res.statusCode.
      `);
    }
    if (typeof encoding === 'string') {
      return body.toString(encoding) as any;
    }
    return body;
  };

  curl.close();
  return { statusCode, headers, body, getBody };
};

export default request;
