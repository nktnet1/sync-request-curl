import fs from 'fs';
import { SERVER_URL } from './app/config';
import request, { HttpVerb, Options } from '../src';
import { describe, expect, test } from 'vitest';
import path from 'path';

// ========================================================================= //

export const wrapperRequest = (
  method: HttpVerb,
  url: string,
  option?: Options
) => {
  const rawResponse = request(method, url, option);
  let json: any;

  try {
    json = JSON.parse(rawResponse.body.toString());
  } catch (error: any) {
    json = { error: `Failed to parse JSON: ${error.message}` };
  }
  return {
    rawResponse,
    json,
    code: rawResponse.statusCode,
  };
};

// ========================================================================= //

describe('GET requests', () => {
  test('GET request with no options', () => {
    const res = wrapperRequest('GET', SERVER_URL);
    expect(res).toMatchObject({
      code: 200,
      json: { message: 'Hello, world!' },
    });
  });

  test('GET request with query string', () => {
    const value = 'Hello, world!';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('GET request url returned correctly parsed', () => {
    const value = 'comp1531';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res.rawResponse.url).toStrictEqual(
      `${SERVER_URL}/get?value=comp1531`
    );
  });

  test('GET request with query string, error 400', () => {
    const value = 'echo';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({
      code: 400,
      json: { error: "Cannot echo 'echo'!" },
    });
  });

  test('GET request with empty array', () => {
    const value: string[] = [];
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: {} });
  });

  test('GET request with undefined value', () => {
    const value = undefined;
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: {} });
  });

  test('GET request with empty string', () => {
    const value = '';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: '' } });
  });

  test('GET request with null value', () => {
    const value = null;
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: '' } });
  });
});

// ========================================================================= //

describe('POST Requests', () => {
  test('POST request with array of numbers', () => {
    const value = [1, 2, 3];
    const res = wrapperRequest('POST', `${SERVER_URL}/post`, {
      json: { value },
    });
    expect(res).toMatchObject({ code: 200, json: { value: [1, 2, 3] } });
  });

  test('POST request with error 400', () => {
    const value = 'post';
    const res = wrapperRequest('POST', `${SERVER_URL}/post`, {
      json: { value },
    });
    expect(res).toMatchObject({
      code: 400,
      json: { error: "Cannot post 'post'!" },
    });
  });
});

// ========================================================================= //

describe('Headers', () => {
  test('DELETE request with headers, code 401', () => {
    const value = 'header';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res).toMatchObject({
      code: 401,
      json: { error: "Cannot header 'header'!" },
    });
  });

  test('DELETE request with headers, valid value', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('DELETE request with headers, empty string', () => {
    const value = '';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('Returned headers has no upper case letters', () => {
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, {
      headers: { value: 'example' },
    });
    for (const header in res.rawResponse.headers) {
      if (
        Object.prototype.hasOwnProperty.call(res.rawResponse.headers, header)
      ) {
        expect(header).toMatch(/^[^A-Z]*$/);
      }
    }
  });

  test('HEAD requests should not contain a body', () => {
    const res = request('HEAD', `${SERVER_URL}/get`);
    expect(res.body.toString()).toStrictEqual('');
  });
});

// ========================================================================= //

describe('Correctly set content-length', () => {
  test('No options', () => {
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`);
    expect(res).toMatchObject({ code: 200, json: { headerLength: 0 } });
  });

  test('JSON payload', () => {
    const json = { message: 'hi', sender: 'Tam' };
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`, {
      json,
    });
    expect(res).toMatchObject({ code: 200, json: { headerLength: 31 } });
  });

  test('Body payload', () => {
    const body = '{"message":"hi","sender":"Tam"}';
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`, {
      body,
    });
    expect(res).toMatchObject({ code: 200, json: { headerLength: 31 } });
  });
});

// ========================================================================= //

// https://github.com/nktnet1/sync-request-curl/issues/116
describe('Sending a buffer', () => {
  const body = fs.readFileSync('./tests/data/length-165.dmp');
  test('Body buffer from file', () => {
    expect(Buffer.byteLength(body)).toStrictEqual(165);
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`, {
      body,
      headers: {
        'Content-Type': 'application/timestamp-query',
      },
    });
    expect(res).toMatchObject({ code: 200, json: { serverBufferLength: 165 } });
  });

  test('External URL for buffer', () => {
    const res = request('POST', 'https://acsk.privatbank.ua/services/tsp/', {
      headers: {
        'Content-Type': 'application/timestamp-query',
      },
      body,
    });
    expect(res.statusCode).toStrictEqual(200);
  });
});

// ========================================================================= //

describe('Body (instead of JSON)', () => {
  test('PUT request code 401', () => {
    const value = { value: 'put' };
    const res = wrapperRequest('PUT', `${SERVER_URL}/put`, {
      body: JSON.stringify(value),
      headers: { 'content-type': 'application/json' },
    });
    expect(res).toMatchObject({
      code: 403,
      json: { error: "Cannot put 'put'!" },
    });
  });

  test('PUT request using valid value in body', () => {
    const value = { value: 'Hello, world!' };
    const res = wrapperRequest('PUT', `${SERVER_URL}/put`, {
      body: JSON.stringify(value),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res).toMatchObject({ code: 200, json: { value: value.value } });
  });

  test('PUT request empty json', () => {
    const res = wrapperRequest('PUT', `${SERVER_URL}/put`, { json: {} });
    expect(res).toMatchObject({ code: 200, json: {} });
  });
});

// ========================================================================= //

describe('res.getBody()', () => {
  test('Using getBody() with no encoding', () => {
    const res = wrapperRequest('GET', SERVER_URL);
    const body = res.rawResponse.getBody();
    expect(body).toBeInstanceOf(Buffer);
  });

  test("Using getBody('utf-8')", () => {
    const res = wrapperRequest('GET', SERVER_URL);
    const body: string = res.rawResponse.getBody('utf-8');
    expect(typeof body).toBe('string');
  });
});

// ========================================================================= //

describe('Redirects', () => {
  test('No redirect', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`, {
      followRedirects: false,
    });
    expect(res).toMatchObject({ code: 302 });
  });

  test('Explicit redirect', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`, {
      followRedirects: true,
    });
    expect(res).toMatchObject({
      code: 200,
      json: { message: 'Redirect success!' },
    });
  });

  test('Implicit redirect (default)', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`);
    expect(res).toMatchObject({
      code: 200,
      json: { message: 'Redirect success!' },
    });
  });

  test('Max redirect 2, causes error', () => {
    const wrap = () =>
      wrapperRequest('GET', `${SERVER_URL}/redirect/source`, {
        qs: { redirectNumber: 3 },
        maxRedirects: 2,
      });
    expect(wrap).toThrow(Error);
  });

  test('Final url returned not redirected', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`, {
      followRedirects: false,
    });
    expect(res.rawResponse.url).toStrictEqual(`${SERVER_URL}/redirect/source`);
  });

  test('Final url returned is the redirect version', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`);
    expect(res.rawResponse.url).toStrictEqual(
      `${SERVER_URL}/redirect/destination`
    );
  });

  test.skip('External URL redirect - https://picsum.photos/200/300', () => {
    const redirectResponse = wrapperRequest(
      'GET',
      'https://picsum.photos/200/300'
    );
    expect(redirectResponse).toMatchObject({ code: 200 });
    const noRedirect = wrapperRequest('GET', 'https://picsum.photos/200/300', {
      followRedirects: false,
    });
    expect(noRedirect).toMatchObject({ code: 302 });
  });
});

// ========================================================================= //

describe('v3.2.0 getJSON method', () => {
  test('Valid JSON body', () => {
    const value = {
      1: 'one',
      two: 2,
      three: true,
      four: null,
      nested: {
        five: false,
        array: [{ key: 'value' }, { key2: 'value2' }],
      },
    };
    const res = request('POST', `${SERVER_URL}/post`, { json: { value } });
    const jsonBody = res.getJSON();
    expect(jsonBody).toStrictEqual({ value });
  });

  test('Invalid JSON body', () => {
    const res = request('POST', `${SERVER_URL}/text`);
    expect(() => res.getJSON()).toThrow(Error);
  });
});

describe('v3.3.0 multipart/formdata', () => {
  test('Can upload one file', () => {
    const testFileLocation = './tests/data/test-upload.txt';
    const res = request('POST', `${SERVER_URL}/upload`, {
      formData: [
        {
          file: testFileLocation,
          name: '1-test-file-upload',
          type: 'text/plain',
        },
        {
          name: '2-test-contents',
          contents: 'Example Content!',
        },
      ],
    });
    expect(res.statusCode).toStrictEqual(200);
    expect(res.getJSON()).toStrictEqual([
      {
        name: '1-test-file-upload',
        file: {
          name: path.basename(testFileLocation),
          size: fs.readFileSync(testFileLocation).length,
          type: 'text/plain',
          lastModified: expect.any(Number),
        },
      },
      { name: '2-test-contents', content: 'Example Content!' },
    ]);
  });
});
