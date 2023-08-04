import { Curl, Easy } from 'node-libcurl';
import { HttpVerb, Options, Response, GetBody } from './types';
import { checkGetBodyStatus, checkValidCurlCode, handleQs, parseReturnedHeaders, parseIncomingHeaders } from './utils';

const handleQueryString = (curl: Easy, url: string, qs?: { [key: string]: any }) => {
  url = qs && Object.keys(qs).length ? handleQs(url, qs) : url;
  curl.setOpt(Curl.option.URL, url);
  return url;
};

const handleOutgoingHeaders = (curl: Easy, returnedHeaderArray: string[]) => {
  curl.setOpt(Curl.option.HEADERFUNCTION, (headerLine) => {
    returnedHeaderArray.push(headerLine.toString('utf-8').trim());
    return headerLine.length;
  });
};

const handleBody = (curl: Easy, options: Options, buffer: { body: Buffer }, httpHeaders: string[]) => {
  if (options.json) {
    httpHeaders.push('Content-Type: application/json');
    curl.setOpt(Curl.option.POSTFIELDS, JSON.stringify(options.json));
  } else if (options.body) {
    curl.setOpt(Curl.option.POSTFIELDS, String(options.body));
  }
  curl.setOpt(Curl.option.WRITEFUNCTION, (buff, nmemb, size) => {
    buffer.body = Buffer.concat([buffer.body, buff.subarray(0, nmemb * size)]);
    return nmemb * size;
  });
};

const request = (method: HttpVerb, url: string, options: Options = {}): Response => {
  const curl = new Easy();

  curl.setOpt(Curl.option.CUSTOMREQUEST, method);
  curl.setOpt(Curl.option.TIMEOUT, options.timeout || false);
  curl.setOpt(Curl.option.FOLLOWLOCATION, options.followRedirects === undefined || options.followRedirects);
  curl.setOpt(Curl.option.MAXREDIRS, options.maxRedirects || Number.MAX_SAFE_INTEGER);

  handleQueryString(curl, url, options.qs);

  const httpHeaders = parseIncomingHeaders(options.headers);
  const returnedHeaderArray: string[] = [];
  handleOutgoingHeaders(curl, returnedHeaderArray);

  const bufferWrap = { body: Buffer.alloc(0) };
  handleBody(curl, options, bufferWrap, httpHeaders);

  curl.setOpt(Curl.option.HTTPHEADER, httpHeaders);
  const code = curl.perform();
  checkValidCurlCode(code, method, url, options);

  url = curl.getInfo('EFFECTIVE_URL').data as string;
  const statusCode = curl.getInfo('RESPONSE_CODE').data as number;
  const body = bufferWrap.body;
  const headers = parseReturnedHeaders(returnedHeaderArray);
  const getBody: GetBody = (encoding?) => {
    checkGetBodyStatus(statusCode, body);
    return typeof encoding === 'string' ? body.toString(encoding) as any : body;
  };

  curl.close();
  return { statusCode, headers, body, getBody, url };
};

export default request;
