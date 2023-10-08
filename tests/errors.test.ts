import request, { CurlError } from '../src';

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
});
