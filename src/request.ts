import { CurlCode, curlOption, EasyOptions } from "#/curl";
import type { NativeCurlOptions } from "#/native";
import native from "#/native";
import type {
  BufferEncoding,
  GetJSON,
  HttpPostField,
  HttpVerb,
  Options,
  Response,
} from "#/types";
import {
  checkValidCurlCode,
  checkValidStatusCode,
  handleQs,
  parseIncomingHeaders,
  parseReturnedHeaders,
} from "#/utils";

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

const getRequestHeaderName = (header: string): string =>
  header.split(/[:;]/, 1)[0].trim().toLowerCase();

const removeRequestHeader = (httpHeaders: string[], name: string): void => {
  const normalizedName = name.toLowerCase();
  for (let i = httpHeaders.length - 1; i >= 0; i -= 1) {
    if (getRequestHeaderName(httpHeaders[i]) === normalizedName) {
      httpHeaders.splice(i, 1);
    }
  }
};

const hasRequestHeader = (httpHeaders: string[], name: string): boolean => {
  const normalizedName = name.toLowerCase();
  return httpHeaders.some(
    (header) => getRequestHeaderName(header) === normalizedName,
  );
};

const setRequestHeader = (
  httpHeaders: string[],
  name: string,
  value: string | number,
): void => {
  removeRequestHeader(httpHeaders, name);
  httpHeaders.push(`${name}: ${value}`);
};

const setContentLengthHeader = (
  httpHeaders: string[],
  length: number,
): void => {
  if (hasRequestHeader(httpHeaders, "transfer-encoding")) {
    removeRequestHeader(httpHeaders, "content-length");
    return;
  }
  setRequestHeader(httpHeaders, "Content-Length", length);
};

interface PreparedPayload {
  body?: string | Buffer;
  formData?: HttpPostField[];
}

const preparePayload = (
  options: Options,
  httpHeaders: string[],
): PreparedPayload => {
  if (options.json !== undefined) {
    setRequestHeader(httpHeaders, "Content-Type", "application/json");
    const payload = JSON.stringify(options.json);
    setContentLengthHeader(httpHeaders, Buffer.byteLength(payload, "utf-8"));
    return { body: payload };
  }

  if (options.body) {
    const length = Buffer.isBuffer(options.body)
      ? options.body.length
      : Buffer.byteLength(options.body, "utf-8");
    setContentLengthHeader(httpHeaders, length);
    return { body: options.body };
  }

  if (options.formData) {
    return { formData: options.formData };
  }

  setContentLengthHeader(httpHeaders, 0);
  return {};
};

const getEasyOptions = (
  options: Options,
  httpHeaders: string[],
): { headers: string[]; curlOptions: NativeCurlOptions } => {
  if (!options.setEasyOptions) {
    return { headers: httpHeaders, curlOptions: {} };
  }

  const easy = new EasyOptions(httpHeaders);
  try {
    options.setEasyOptions(easy, curlOption);
    return easy.snapshot();
  } finally {
    easy.close();
  }
};

const performRequest = (
  method: HttpVerb,
  url: string,
  options: Options,
): { response: Response; redirectUrl: string | null } => {
  const requestUrl =
    options.qs && Object.keys(options.qs).length
      ? handleQs(url, options.qs)
      : url;

  const httpHeaders = parseIncomingHeaders(options.headers);
  const payload = preparePayload(options, httpHeaders);
  const easyOptions = getEasyOptions(options, httpHeaders);

  const result = native.request({
    method,
    url: requestUrl,
    headers: easyOptions.headers,
    ...payload,
    timeout: options.timeout ?? 0,
    insecure: options.insecure ?? false,
    noBody: method === "HEAD",
    curlOptions: easyOptions.curlOptions,
  });

  checkValidCurlCode(result.code, result.errorMessage, {
    method,
    url,
    options,
  });

  const statusCode = result.statusCode;
  const headers = parseReturnedHeaders(result.headers);
  const body = result.body;

  function getBody<Encoding extends BufferEncoding>(encoding: Encoding): string;
  function getBody(encoding?: undefined): Buffer;
  function getBody(encoding?: BufferEncoding): string | Buffer {
    checkValidStatusCode(statusCode, body);
    return encoding ? body.toString(encoding) : body;
  }

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

  return {
    response: {
      statusCode,
      headers,
      url: result.effectiveUrl ?? requestUrl,
      body,
      getBody,
      getJSON,
    },
    redirectUrl: result.redirectUrl,
  };
};

const request = (
  method: HttpVerb,
  url: string,
  options: Options = {},
): Response => {
  const shouldFollowRedirects = options.followRedirects !== false;
  if (!shouldFollowRedirects) {
    return performRequest(method, url, options).response;
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
        checkValidCurlCode(
          CurlCode.CURLE_OPERATION_TIMEDOUT,
          "Operation timed out",
          { method, url, options },
        );
      }
      currentOptions = { ...currentOptions, timeout: remainingTimeout };
    }

    const { response, redirectUrl } = performRequest(
      currentMethod,
      currentUrl,
      currentOptions,
    );
    if (!redirectUrl) {
      return response;
    }

    if (maxRedirects >= 0 && redirectsFollowed >= maxRedirects) {
      checkValidCurlCode(
        CurlCode.CURLE_TOO_MANY_REDIRECTS,
        "Number of redirects hit maximum amount",
        { method, url, options },
      );
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
