import { Curl, Easy } from 'node-libcurl';
import { HttpVerb, Options, Response, GetBody } from './types';
import {
  checkGetBodyStatus,
  checkValidCurlCode,
  handleQs,
  parseReturnedHeaders,
  parseIncomingHeaders,
} from './utils';

/**
 * Create a libcurl Easy object with default configurations
 *
 * @param {HttpVerb} method - The HTTP method (e.g., 'GET', 'POST', 'PUT')
 * @param {Options} options - configuration options for the request.
 * @returns {Easy} an initialized libcurl Easy object with default options
 * ```
 */
const createCurlObjectWithDefaults = (method: HttpVerb, options: Options): Easy => {
  const curl = new Easy();
  curl.setOpt(Curl.option.CUSTOMREQUEST, method);
  curl.setOpt(Curl.option.TIMEOUT_MS, options.timeout ?? 0);
  curl.setOpt(
    Curl.option.FOLLOWLOCATION, options.followRedirects === undefined ||
    options.followRedirects
  );
  curl.setOpt(Curl.option.MAXREDIRS, options.maxRedirects ?? -1);
  curl.setOpt(Curl.option.SSL_VERIFYPEER, !options.insecure);
  return curl;
};

/**
 * Handles query string parameters in a URL, modifies the URL if necessary,
 * and sets it as the CURLOPT_URL option in the given cURL Easy object.
 *
 * @param {Easy} curl - The cURL easy handle
 * @param {string} url - The URL to handle query string parameters for
 * @param {Object.<string, any>} qs - query string parameters for the request
 * @returns {string} The modified URL with the updated query string parameters
 */
const handleQueryString = (
  curl: Easy, url: string, qs?: { [key: string]: any }
): string => {
  url = qs && Object.keys(qs).length ? handleQs(url, qs) : url;
  curl.setOpt(Curl.option.URL, url);
  return url;
};

/**
 * Sets up a callback function for the cURL Easy object to handle returned
 * headers and populate the input array with header lines.
 *
 * @param {Easy} curl - The cURL easy handle
 * @param {string[]} returnedHeaderArray - array for returned header lines
 */
const handleOutgoingHeaders = (curl: Easy, returnedHeaderArray: string[]) => {
  curl.setOpt(Curl.option.HEADERFUNCTION, (headerLine) => {
    returnedHeaderArray.push(headerLine.toString('utf-8').trim());
    return headerLine.length;
  });
};

/**
 * Prepares the request body and headers for a cURL request based on provided
 * options. Also sets up a callback function for the cURL Easy object to handle
 * returned body and populates the input buffet.
 *
 * @param {Easy} curl - The cURL easy handle
 * @param {Options} options - Options for configuring the request
 * @param {{ body: Buffer }} buffer - wrapped buffer for the returned body
 * @param {string[]} httpHeaders - HTTP headers for the request
 */
const handleBody = (
  curl: Easy, options: Options, buffer: { body: Buffer }, httpHeaders: string[]
) => {
  let payload = '';
  if (options.json) {
    httpHeaders.push('Content-Type: application/json');
    payload = JSON.stringify(options.json);
  } else if (options.body) {
    payload = options.body.toString();
  }
  httpHeaders.push(`Content-Length: ${payload.length}`);
  curl.setOpt(Curl.option.POSTFIELDS, payload);
  curl.setOpt(Curl.option.WRITEFUNCTION, (buff, nmemb, size) => {
    buffer.body = Buffer.concat([buffer.body, buff.subarray(0, nmemb * size)]);
    return nmemb * size;
  });
};

/**
 * Performs an HTTP request using cURL with the specified parameters.
 *
 * @param {HttpVerb} method - The HTTP method for the request (e.g., 'GET', 'POST')
 * @param {string} url - The URL to make the request to
 * @param {Options} [options={}] - An object to configure the request
 * @returns {Response} - HTTP response consisting of status code, headers, and body
 */
const request = (method: HttpVerb, url: string, options: Options = {}): Response => {
  const curl = createCurlObjectWithDefaults(method, options);

  handleQueryString(curl, url, options.qs);

  // Headers (both incoming and outgoing)
  const httpHeaders = parseIncomingHeaders(options.headers);
  const returnedHeaderArray: string[] = [];
  handleOutgoingHeaders(curl, returnedHeaderArray);

  // Body (and JSON)
  const bufferWrap = { body: Buffer.alloc(0) };
  handleBody(curl, options, bufferWrap, httpHeaders);
  curl.setOpt(Curl.option.HTTPHEADER, httpHeaders);

  if (options.setEasyOptions) {
    options.setEasyOptions(curl, Curl.option);
  }

  // Execute request
  const code = curl.perform();
  checkValidCurlCode(code, { method, url, options });

  // Creating return object
  const statusCode = curl.getInfo('RESPONSE_CODE').data as number;
  const headers = parseReturnedHeaders(returnedHeaderArray);
  const { body } = bufferWrap;

  /**
   * Get the body of a response with an optional encoding.
   *
   * @throws {Error} if the status code is >= 300
   * @returns {Buffer | string} buffer body by default, string body with encoding
   */
  const getBody: GetBody = (encoding?) => {
    checkGetBodyStatus(statusCode, body);
    return typeof encoding === 'string' ? body.toString(encoding) as any : body;
  };

  url = curl.getInfo('EFFECTIVE_URL').data as string;

  curl.close();
  return { statusCode, headers, body, getBody, url };
};

export default request;
