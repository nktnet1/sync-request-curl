import request, { CurlError } from '../src';
import { SERVER_URL } from './app/config';

describe('CurlError class', () => {
  test('new Curlcode > 99', () => {
    expect(() => new CurlError(100, 'Error 100')).toThrow(Error);
  });
  test('new Curlcode < 1', () => {
    expect(() => new CurlError(0, 'Error 0')).toThrow(Error);
    expect(() => new CurlError(-1, 'Error 0')).toThrow(Error);
  });
});

describe('Requests that give Libcurl error', () => {
  test('Malformed URL (not properly formatted)', () => {
    expect(() => request('GET', '')).toThrow(CurlError);
    try {
      request('GET', '');
    } catch (error) {
      expect(error).toBeInstanceOf(CurlError);
      expect((error as CurlError).code).toStrictEqual(3);
    }
  });

  test('Request non-existent server- CURLE_COULDNT_RESOLVE_HOST (6)', () => {
    const invalidUrl = 'https://google.fake.url.com';
    expect(() => request('GET', invalidUrl)).toThrow(CurlError);
    try {
      request('GET', invalidUrl);
    } catch (error) {
      expect(error).toBeInstanceOf(CurlError);
      expect((error as CurlError).code).toStrictEqual(6);
    }
  });

  test('Timeout after 1 second - CURLE_OPERATION_TIMEDOUT (28)', () => {
    const timeoutRequest = () => request(
      'POST',
        `${SERVER_URL}/timeout`,
        { json: { timeout: 1000 }, timeout: 200 }
    );
    expect(timeoutRequest).toThrow(CurlError);

    try {
      timeoutRequest();
    } catch (error) {
      expect(error).toBeInstanceOf(CurlError);
      expect((error as CurlError).code).toStrictEqual(28);
    }
  });
});

describe('Other errors', () => {
  test('getBody() throw error for 401 status code', () => {
    const value = 'header';
    const res = request('DELETE', `${SERVER_URL}/delete`, { headers: { value } });
    expect(res.statusCode).toBe(401);
    expect(() => res.getBody()).toThrow(Error);
  });

  test('getBody() throw error for 404 status code', () => {
    const res = request('DELETE', `${SERVER_URL}/unknown`);
    expect(res.statusCode).toBe(404);
    expect(() => res.getBody()).toThrow(Error);
  });
});
