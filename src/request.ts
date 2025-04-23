import { Curl, Easy, HttpPostField } from 'node-libcurl';
import { HttpVerb, Options, Response, GetJSON } from './@types';
import {
  checkValidStatusCode,
  checkValidCurlCode,
  handleQs,
  parseReturnedHeaders,
  parseIncomingHeaders,
} from './utils';
import type { JsonValue } from './@types/json';
import type { BufferEncoding } from './@types';

/**
 * Create a libcurl Easy object with default configurations
 *
 * @param {HttpVerb} method - The HTTP method (e.g., 'GET', 'POST', 'PUT')
 * @param {Options} options - configuration options for the request.
 * @returns {Easy} an initialized libcurl Easy object with default options
 */
const createCurlObjectWithDefaults = (
  method: HttpVerb,
  options: Options
): Easy => {
  const curl = new Easy();
  curl.setOpt(Curl.option.CUSTOMREQUEST, method);
  curl.setOpt(Curl.option.TIMEOUT_MS, options.timeout ?? 0);
  curl.setOpt(
    Curl.option.FOLLOWLOCATION,
    options.followRedirects === undefined || options.followRedirects
  );
  curl.setOpt(Curl.option.MAXREDIRS, options.maxRedirects ?? -1);
  curl.setOpt(Curl.option.SSL_VERIFYPEER, !options.insecure);
  curl.setOpt(Curl.option.NOBODY, method === 'HEAD');
  return curl;
};

/**
 * Handles query string parameters in a URL, modifies the URL if necessary,
 * and sets it as the CURLOPT_URL option in the given cURL Easy object.
 *
 * @param {Easy} curl - The cURL easy handle
 * @param {string} url - The URL to handle query string parameters for
 * @param {Object.<string, JsonValue>} qs - query string parameters for the request
 */
const handleQueryString = (
  curl: Easy,
  url: string,
  qs?: { [key: string]: JsonValue }
): void => {
  url = qs && Object.keys(qs).length ? handleQs(url, qs) : url;
  curl.setOpt(Curl.option.URL, url);
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
 * Sets the JSON payload for the curl request.
 * @param {Easy} curl - The curl object.
 * @param {JsonValue} json - The JSON body to be sent
 * @param {string[]} httpHeaders - HTTP headers for the request
 */
const setJSONPayload = (curl: Easy, json: JsonValue, httpHeaders: string[]): void => {
  httpHeaders.push('Content-Type: application/json');
  const payload = JSON.stringify(json);
  httpHeaders.push(`Content-Length: ${Buffer.byteLength(payload, 'utf-8')}`);
  curl.setOpt(Curl.option.POSTFIELDS, payload);
};

/**
 * Sets the buffer payload for the curl request.
 * @param {Easy} curl - The curl object.
 * @param {string | Buffer} body - The body to be sent in the request.
 * @param {string[]} httpHeaders - HTTP headers for the request
 */
const setBodyPayload = (
  curl: Easy,
  body: string | Buffer,
  httpHeaders: string[]
): void => {
  if (Buffer.isBuffer(body)) {
    let position = 0;
    curl.setOpt(Curl.option.POST, true);
    curl.setOpt(Curl.option.POSTFIELDSIZE, -1);
    curl.setOpt(
      Curl.option.READFUNCTION,
      (buffer: Buffer, size: number, nmemb: number): number => {
        const amountToRead = size * nmemb;
        if (position === body.length) {
          return 0;
        }
        const totalWritten = body.copy(
          buffer,
          0,
          position,
          Math.min(amountToRead, body.length)
        );
        position += totalWritten;
        return totalWritten;
      }
    );
  } else {
    curl.setOpt(Curl.option.POSTFIELDS, body);
    httpHeaders.push(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}`);
  }
};

/**
 * Sets the buffer payload for the curl request.
 * @param {Easy} curl - The curl object.
 * @param {Array<HttpPostField>} formData - list of files/contents to be sent
 */
const setFormPayload = (curl: Easy, formData: HttpPostField[]) => {
  curl.setOpt(Curl.option.HTTPPOST, formData);
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
const handleBodyAndRequestHeaders = (
  curl: Easy,
  options: Options,
  buffer: { body: Buffer },
  httpHeaders: string[]
): void => {
  if (options.json) {
    setJSONPayload(curl, options.json, httpHeaders);
  } else if (options.body) {
    setBodyPayload(curl, options.body, httpHeaders);
  } else if (options.formData) {
    setFormPayload(curl, options.formData);
  } else {
    httpHeaders.push('Content-Length: 0');
  }
  curl.setOpt(Curl.option.WRITEFUNCTION, (buff, nmemb, size) => {
    buffer.body = Buffer.concat([buffer.body, buff.subarray(0, nmemb * size)]);
    return nmemb * size;
  });

  curl.setOpt(Curl.option.HTTPHEADER, httpHeaders);
};

/**
 * Performs an HTTP request using cURL with the specified parameters.
 *
 * @param {HttpVerb} method - The HTTP method for the request (e.g., 'GET', 'POST')
 * @param {string} url - The URL to make the request to
 * @param {Options} [options={}] - An object to configure the request
 * @returns {Response} - HTTP response consisting of status code, headers, and body
 */
const request = (
  method: HttpVerb,
  url: string,
  options: Options = {}
): Response => {
  const curl = createCurlObjectWithDefaults(method, options);
  handleQueryString(curl, url, options.qs);

  // Body/JSON and Headers (incoming)
  const bufferWrap = { body: Buffer.alloc(0) };
  handleBodyAndRequestHeaders(
    curl,
    options,
    bufferWrap,
    parseIncomingHeaders(options.headers)
  );

  // Headers (outgoing)
  const returnedHeaderArray: string[] = [];
  handleOutgoingHeaders(curl, returnedHeaderArray);

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
  function getBody<Encoding extends BufferEncoding>(encoding: Encoding): string;
  function getBody(encoding?: undefined): Buffer;
  function getBody(encoding?: BufferEncoding): string | Buffer {
    checkValidStatusCode(statusCode, body);
    return encoding ? body.toString(encoding) : body;
  }

  /**
   * Get the JSON-parsed body of a response.
   *
   * @throws {Error} if the body is into a valid JSON
   * @returns {JsonValue} parsed JSON body
   */
  const getJSON: GetJSON = (encoding?) => {
    try {
      return JSON.parse(body.toString(encoding));
    } catch (err) {
      throw new Error(`
The server body response for
  - ${method}
  - ${url}
cannot be parsed as JSON.

Body:
  ${body.toString(encoding)}

JSON-Parsing Error Message:
  ${err instanceof Error ? err.message : String(err)}
      `);
    }
  };

  url = curl.getInfo('EFFECTIVE_URL').data as string;

  curl.close();
  return { statusCode, headers, url, body, getBody, getJSON };
};

export default request;
