import { SERVER_URL } from './app/config';
import request, { HttpVerb, Options } from '../src';

// ========================================================================= //

export const wrapperRequest = (method: HttpVerb, url: string, option?: Options) => {
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
    expect(res).toMatchObject({ code: 200, json: { message: 'Hello, world!' } });
  });

  test('GET request with query string', () => {
    const value = 'Hello, world!';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('GET request url returned correctly parsed', () => {
    const value = 'comp1531';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res.rawResponse.url).toStrictEqual(SERVER_URL + '/get?value=comp1531');
  });

  test('GET request with query string, error 400', () => {
    const value = 'echo';
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 400, json: { error: "Cannot echo 'echo'!" } });
  });

  test('GET request with array of one number', () => {
    const value = [1];
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: ['1'] } });
  });

  test('GET request with array of numbers', () => {
    const value = [1, 2, 3];
    const res = wrapperRequest('GET', `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: ['1', '2', '3'] } });
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
    const res = wrapperRequest('POST', `${SERVER_URL}/post`, { json: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: [1, 2, 3] } });
  });

  test('POST request with error 400', () => {
    const value = 'post';
    const res = wrapperRequest('POST', `${SERVER_URL}/post`, { json: { value } });
    expect(res).toMatchObject({ code: 400, json: { error: "Cannot post 'post'!" } });
  });
});

// ========================================================================= //

describe('Headers', () => {
  test('DELETE request with headers, code 401', () => {
    const value = 'header';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, { headers: { value } });
    expect(res).toMatchObject({ code: 401, json: { error: "Cannot header 'header'!" } });
  });

  test('DELETE request with headers, valid value', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, { headers: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('DELETE request with headers, empty string', () => {
    const value = '';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, { headers: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('Returned headers has no upper case letters', () => {
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, { headers: { value: 'example' } });
    for (const header in Object.keys(res.rawResponse.headers)) {
      expect(header).toMatch(/^[^A-Z]*$/);
    }
  });
});

// ========================================================================= //

describe('Correctly set content-length', () => {
  test('No options', () => {
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`);
    expect(res).toMatchObject({ code: 200, json: { length: '0' } });
  });

  test('JSON payload', () => {
    const json = { message: 'hi', sender: 'Tam' };
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`, { json });
    expect(res).toMatchObject({ code: 200, json: { length: '31' } });
  });

  test('Body payload', () => {
    const body = '{"message":"hi","sender":"Tam"}';
    const res = wrapperRequest('POST', `${SERVER_URL}/content/length`, { body });
    expect(res).toMatchObject({ code: 200, json: { length: '31' } });
  });
});

// ========================================================================= //

describe('Body (instead of JSON)', () => {
  test('PUT request code 401', () => {
    const value = { value: 'put' };
    const res = wrapperRequest(
      'PUT',
      `${SERVER_URL}/put`,
      { body: JSON.stringify(value), headers: { 'content-type': 'application/json' } }
    );
    expect(res).toMatchObject({ code: 403, json: { error: "Cannot put 'put'!" } });
  });

  test('PUT request using valid value in body', () => {
    const value = { value: 'Hello, world!' };
    const res = wrapperRequest(
      'PUT',
      `${SERVER_URL}/put`,
      { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } }
    );
    expect(res).toMatchObject({ code: 200, json: { value: value.value } });
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
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`, { followRedirects: false });
    expect(res).toMatchObject({ code: 302 });
  });

  test('Explicit redirect', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`, { followRedirects: true });
    expect(res).toMatchObject({ code: 200, json: { message: 'Redirect success!' } });
  });

  test('Implicit redirect (default)', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`);
    expect(res).toMatchObject({ code: 200, json: { message: 'Redirect success!' } });
  });

  test('Max redirect 2, causes error', () => {
    const wrap = () => wrapperRequest('GET', `${SERVER_URL}/redirect/source`, { qs: { redirectNumber: 3 }, maxRedirects: 2 });
    expect(wrap).toThrow(Error);
  });

  test('Final url returned not redirected', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`, { followRedirects: false });
    expect(res.rawResponse.url).toStrictEqual(`${SERVER_URL}/redirect/source`);
  });

  test('Final url returned is the redirect version', () => {
    const res = wrapperRequest('GET', `${SERVER_URL}/redirect/source`);
    expect(res.rawResponse.url).toStrictEqual(`${SERVER_URL}/redirect/destination`);
  });

  test.skip('External URL redirect - https://picsum.photos/200/300', () => {
    const redirectResponse = wrapperRequest('GET', 'https://picsum.photos/200/300');
    expect(redirectResponse).toMatchObject({ code: 200 });
    const noRedirect = wrapperRequest('GET', 'https://picsum.photos/200/300', { followRedirects: false });
    expect(noRedirect).toMatchObject({ code: 302 });
  });
});

// ========================================================================= //

describe('Errors', () => {
  test('Malformed Url', () => {
    expect(() => wrapperRequest('GET', `invalid${SERVER_URL}`)).toThrow(Error);
    expect(() => wrapperRequest('GET', '')).toThrow(Error);
  });

  test('getBody() throw error for 401 status code', () => {
    const value = 'header';
    const res = wrapperRequest('DELETE', `${SERVER_URL}/delete`, { headers: { value } });
    expect(res.code).toBe(401);
    expect(() => res.rawResponse.getBody()).toThrow(Error);
  });

  test('getBody() throw error for 404 status code', () => {
    const res = wrapperRequest('DELETE', `${SERVER_URL}/unknown`);
    expect(res.code).toBe(404);
    expect(() => res.rawResponse.getBody()).toThrow(Error);
  });
});
