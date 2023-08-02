import request, { HttpVerb, Options } from '../src';
// import request, { HttpVerb, Options } from 'sync-request';
import { SERVER_URL } from './config';

const wrapperRequest = (method: HttpVerb, url: string, option?: Options) => {
  const rawResponse = request(method, url, option);
  return {
    rawResponse,
    code: rawResponse.statusCode,
    json: JSON.parse(rawResponse.body.toString()),
  };
};

test('GET request with no options', () => {
  const res = wrapperRequest('GET', SERVER_URL);
  expect(res).toMatchObject({ code: 200, json: { message: 'Hello, world!' } });
});

test('GET request with query string', () => {
  const value = 'Hello, world!';
  const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
  expect(res).toMatchObject({ code: 200, json: { value } });
});

test('GET request with query string', () => {
  const value = 'Hello, world!';
  const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
  expect(res).toMatchObject({ code: 200, json: { value } });
});

test('GET request with query string, error 400', () => {
  const value = 'echo';
  const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
  expect(res).toMatchObject({ code: 400, json: { error: "Cannot echo 'echo'!" } });
});

test('GET request with array of numbers', () => {
  const value = [1, 2, 3];
  const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
  expect(res).toMatchObject({ code: 200, json: { value: ['1', '2', '3'] } });
});
