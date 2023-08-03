import request, { HttpVerb, Options } from '../src';
// import request, { HttpVerb, Options } from 'sync-request';
import { SERVER_URL } from './app/config';

// ========================================================================= //

const wrapperRequest = (method: HttpVerb, url: string, option?: Options) => {
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
    const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('GET request url returned correctly parsed', () => {
    const value = 'comp1531';
    const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
    expect(res.rawResponse.url).toStrictEqual(SERVER_URL + '/echo?value=comp1531');
  });

  test('GET request with query string, error 400', () => {
    const value = 'echo';
    const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
    expect(res).toMatchObject({ code: 400, json: { error: "Cannot echo 'echo'!" } });
  });

  test('GET request with array of one number', () => {
    const value = [1];
    const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: ['1'] } });
  });

  test('GET request with array of numbers', () => {
    const value = [1, 2, 3];
    const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: ['1', '2', '3'] } });
  });

  test('GET request with empty array', () => {
    const value = [];
    const res = wrapperRequest('GET', SERVER_URL + '/echo', { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: {} });
  });
});

// ========================================================================= //

describe('POST Requests', () => {
  test('POST request with array of numbers', () => {
    const value = [1, 2, 3];
    const res = wrapperRequest('POST', SERVER_URL + '/poeko', { json: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: [1, 2, 3] } });
  });

  test('POST request with error 400', () => {
    const value = 'poeko';
    const res = wrapperRequest('POST', SERVER_URL + '/poeko', { json: { value } });
    expect(res).toMatchObject({ code: 400, json: { error: "Cannot poeko 'poeko'!" } });
  });
});

// ========================================================================= //

describe('Headers', () => {
  test('DELETE request with headers, code 401', () => {
    const value = 'heako';
    const res = wrapperRequest('DELETE', SERVER_URL + '/heako', { headers: { value } });
    expect(res).toMatchObject({ code: 401, json: { error: "Cannot heako 'heako'!" } });
  });

  test('DELETE request with headers, valid value', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz';
    const res = wrapperRequest('DELETE', SERVER_URL + '/heako', { headers: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test('DELETE request with headers, empty string', () => {
    const value = '';
    const res = wrapperRequest('DELETE', SERVER_URL + '/heako', { headers: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });
});

// ========================================================================= //

describe('Body (instead of JSON)', () => {
  test('PUT request code 401', () => {
    const value = { value: 'pueko' };
    const res = wrapperRequest(
      'PUT',
      SERVER_URL + '/pueko',
      { body: JSON.stringify(value), headers: { 'content-type': 'application/json' } }
    );
    expect(res).toMatchObject({ code: 403, json: { error: "Cannot pueko 'pueko'!" } });
  });

  test('PUT request using valid value in body', () => {
    const value = { value: 'Hello, world!' };
    const res = wrapperRequest(
      'PUT',
      SERVER_URL + '/pueko',
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
    const res = wrapperRequest('GET', SERVER_URL + '/redirect/source', { followRedirects: false });
    expect(res).toMatchObject({ code: 302 });
  });

  test('Explicit redirect', () => {
    const res = wrapperRequest('GET', SERVER_URL + '/redirect/source', { followRedirects: true });
    expect(res).toMatchObject({ code: 200, json: { message: 'Redirect success!' } });
  });

  test('Implicit redirect (default)', () => {
    const res = wrapperRequest('GET', SERVER_URL + '/redirect/source');
    expect(res).toMatchObject({ code: 200, json: { message: 'Redirect success!' } });
  });

  test('Max redirect 2, causes error', () => {
    const wrap = () => wrapperRequest('GET', SERVER_URL + '/redirect/source', { qs: { redirectNumber: 3 }, maxRedirects: 2 });
    expect(wrap).toThrow(Error);
  });

  test('Final url returned not redirected', () => {
    const res = wrapperRequest('GET', SERVER_URL + '/redirect/source', { followRedirects: false });
    expect(res.rawResponse.url).toStrictEqual(SERVER_URL + '/redirect/source');
  });

  test('Final url returned is the redirect version', () => {
    const res = wrapperRequest('GET', SERVER_URL + '/redirect/source');
    expect(res.rawResponse.url).toStrictEqual(SERVER_URL + '/redirect/destination');
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
    expect(() => wrapperRequest('GET', 'a' + SERVER_URL)).toThrow(Error);
    expect(() => wrapperRequest('GET', '')).toThrow(Error);
  });

  test('getBody() throw error for 401 status code', () => {
    const value = 'heako';
    const res = wrapperRequest('DELETE', SERVER_URL + '/heako', { headers: { value } });
    expect(res.code).toBe(401);
    expect(() => res.rawResponse.getBody()).toThrow(Error);
  });

  test('getBody() throw error for 404 status code', () => {
    const res = wrapperRequest('DELETE', SERVER_URL + '/unknown');
    expect(res.code).toBe(404);
    expect(() => res.rawResponse.getBody()).toThrow(Error);
  });
});
