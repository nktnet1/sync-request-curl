import { Curl, CurlCode, Easy, type HttpPostField } from "node-libcurl";
import type {
  BufferEncoding,
  CustomJsonType,
  GetJSON,
  HttpVerb,
  Options,
  Response,
} from "./types";
import {
  checkValidCurlCode,
  checkValidStatusCode,
  handleQs,
  parseIncomingHeaders,
  parseReturnedHeaders,
} from "./utils";

const CURL_FOLLOW_OBEY_CODE = 2;
/**
 * Create a libcurl Easy object with default configurations
 *
 * @param {HttpVerb} method - The HTTP method (e.g., 'GET', 'POST', 'PUT')
 * @param {Options} options - configuration options for the request.
 * @returns {Easy} an initialized libcurl Easy object with default options
 */
const createCurlObjectWithDefaults = (
  method: HttpVerb,
  options: Options,
  followRedirects: boolean,
): Easy => {
  const curl = new Easy();
  curl.setOpt(Curl.option.CUSTOMREQUEST, method);
  curl.setOpt(Curl.option.TIMEOUT_MS, options.timeout ?? 0);
  curl.setOpt(
    Curl.option.FOLLOWLOCATION,
    followRedirects ? CURL_FOLLOW_OBEY_CODE : 0,
  );
  curl.setOpt(Curl.option.MAXREDIRS, options.maxRedirects ?? -1);
  curl.setOpt(Curl.option.SSL_VERIFYPEER, !options.insecure);
  curl.setOpt(Curl.option.NOBODY, method === "HEAD");
  return curl;
};

const hasCustomHeaders = (options: Options): boolean =>
  Object.values(options.headers ?? {}).some((value) => value !== undefined);

const getRedirectMethod = (method: HttpVerb, statusCode: number): HttpVerb => {
  if (statusCode === 303 && method !== "HEAD") {
    return "GET";
  }
  if ((statusCode === 301 || statusCode === 302) && method === "POST") {
    return "GET";
  }
  return method;
};

const removeRequestPayload = (options: Options): Options => ({
  ...options,
  json: undefined,
  body: undefined,
  formData: undefined,
});

/**
 * Handles query string parameters in a URL, modifies the URL if necessary,
 * and sets it as the CURLOPT_URL option in the given cURL Easy object.
 *
 * @param {Easy} curl - The cURL easy handle
 * @param {string} url - The URL to handle query string parameters for
 * @param {Object.<string, any>} qs - query string parameters for the request
 */
const handleQueryString = (
  curl: Easy,
  url: string,
  qs?: { [key: string]: unknown },
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
    returnedHeaderArray.push(headerLine.toString("utf-8").trim());
    return headerLine.length;
  });
};

/**
 * Sets the JSON payload for the curl request.
 * @param {Easy} curl - The curl object.
 * @param {any} json - The JSON body to be sent
 * @param {string[]} httpHeaders - HTTP headers for the request
 */
const setJSONPayload = (
  curl: Easy,
  json: CustomJsonType,
  httpHeaders: string[],
): void => {
  httpHeaders.push("Content-Type: application/json");
  const payload = JSON.stringify(json);
  httpHeaders.push(`Content-Length: ${Buffer.byteLength(payload, "utf-8")}`);
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
  httpHeaders: string[],
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
          Math.min(position + amountToRead, body.length),
        );
        position += totalWritten;
        return totalWritten;
      },
    );
  } else {
    curl.setOpt(Curl.option.POSTFIELDS, body);
    httpHeaders.push(`Content-Length: ${Buffer.byteLength(body, "utf-8")}`);
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
 * @param {{ body: Buffer[] }} buffer - wrapped chunks for the returned body
 * @param {string[]} httpHeaders - HTTP headers for the request
 */
const handleBodyAndRequestHeaders = (
  curl: Easy,
  options: Options,
  buffer: { body: Buffer[] },
  httpHeaders: string[],
): void => {
  if (options.json !== undefined) {
    setJSONPayload(curl, options.json, httpHeaders);
  } else if (options.body) {
    setBodyPayload(curl, options.body, httpHeaders);
  } else if (options.formData) {
    setFormPayload(curl, options.formData);
  } else {
    httpHeaders.push("Content-Length: 0");
  }
  curl.setOpt(Curl.option.WRITEFUNCTION, (buff, nmemb, size) => {
    buffer.body.push(Buffer.from(buff.subarray(0, nmemb * size)));
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
const performRequest = (
  method: HttpVerb,
  url: string,
  options: Options,
  followRedirects: boolean,
): { response: Response; redirectUrl: string | null } => {
  const curl = createCurlObjectWithDefaults(method, options, followRedirects);
  try {
    handleQueryString(curl, url, options.qs);

    // Body/JSON and Headers (incoming)
    const bufferWrap: { body: Buffer[] } = { body: [] };
    handleBodyAndRequestHeaders(
      curl,
      options,
      bufferWrap,
      parseIncomingHeaders(options.headers),
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
    const statusCode = curl.getInfo("RESPONSE_CODE").data as number;
    const headers = parseReturnedHeaders(returnedHeaderArray);
    const body = Buffer.concat(bufferWrap.body);
    const redirectUrl = curl.getInfo("REDIRECT_URL").data as string | null;

    /**
     * Get the body of a response with an optional encoding.
     *
     * @throws {Error} if the status code is >= 300
     * @returns {Buffer | string} buffer body by default, string body with encoding
     */

    function getBody<Encoding extends BufferEncoding>(
      encoding: Encoding,
    ): string;
    function getBody(encoding?: undefined): Buffer;
    function getBody(encoding?: BufferEncoding): string | Buffer {
      checkValidStatusCode(statusCode, body);
      return encoding ? body.toString(encoding) : body;
    }

    /**
     * Get the JSON-parsed body of a response.
     *
     * @throws {Error} if the body is into a valid JSON
     * @returns {any} parsed JSON body
     */
    const getJSON: GetJSON = (encoding?) => {
      try {
        return JSON.parse(body.toString(encoding));
      } catch (err) {
        /* v8 ignore next */
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
          `
The server body response for
  - ${method}
  - ${url}
cannot be parsed as JSON.

Body:
  ${body.toString(encoding)}

JSON-Parsing Error Message:
  ${errorMessage}
      `,
          { cause: err },
        );
      }
    };

    url = curl.getInfo("EFFECTIVE_URL").data as string;

    return {
      response: { statusCode, headers, url, body, getBody, getJSON },
      redirectUrl,
    };
  } finally {
    curl.close();
  }
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
  options: Options = {},
): Response => {
  const shouldFollowRedirects = options.followRedirects !== false;

  // libcurl forwards arbitrary CURLOPT_HTTPHEADER values across origins when
  // following redirects. If there are no custom headers, its native redirect
  // handling is safe and avoids duplicating the redirect machinery here.
  if (!shouldFollowRedirects || !hasCustomHeaders(options)) {
    return performRequest(method, url, options, shouldFollowRedirects).response;
  }

  const startedAt = Date.now();
  const maxRedirects = options.maxRedirects ?? -1;
  let redirectsFollowed = 0;
  let currentMethod = method;
  let currentUrl = url;
  let currentOptions = options;

  while (true) {
    if (options.timeout && options.timeout > 0) {
      const remainingTimeout = options.timeout - (Date.now() - startedAt);
      if (remainingTimeout <= 0) {
        checkValidCurlCode(CurlCode.CURLE_OPERATION_TIMEDOUT, {
          method,
          url,
          options,
        });
      }
      currentOptions = { ...currentOptions, timeout: remainingTimeout };
    }

    const { response, redirectUrl } = performRequest(
      currentMethod,
      currentUrl,
      currentOptions,
      false,
    );
    if (!redirectUrl) {
      return response;
    }

    if (maxRedirects >= 0 && redirectsFollowed >= maxRedirects) {
      checkValidCurlCode(CurlCode.CURLE_TOO_MANY_REDIRECTS, {
        method,
        url,
        options,
      });
    }
    redirectsFollowed += 1;

    const nextUrl = new URL(redirectUrl, response.url).href;
    const nextMethod = getRedirectMethod(currentMethod, response.statusCode);
    const sameOrigin = new URL(response.url).origin === new URL(nextUrl).origin;

    currentOptions = {
      ...(nextMethod === currentMethod
        ? currentOptions
        : removeRequestPayload(currentOptions)),
      qs: undefined,
      headers: sameOrigin ? currentOptions.headers : undefined,
    };
    currentMethod = nextMethod;
    currentUrl = nextUrl;
  }
};

export default request;
