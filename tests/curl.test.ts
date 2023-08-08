import { SERVER_URL } from './app/config';
import request, { SetEasyOptionCallback } from '../src';

describe('Callback setEasyOptions', () => {
  const setEasyOptions: SetEasyOptionCallback = (curl, options) => {
    curl.setOpt(options.HTTPHEADER, ['value: Tammy McTamtam']);
  };

  test('Curl easy option set for headers', () => {
    const res = request('DELETE', SERVER_URL + '/delete', { setEasyOptions });
    expect(JSON.parse(res.body.toString())).toStrictEqual({ value: 'Tammy McTamtam' });
  });

  test('Curl easy option set, override headers', () => {
    const res = request('DELETE', SERVER_URL + '/delete', { headers: { value: 'override me' }, setEasyOptions });
    expect(JSON.parse(res.body.toString())).toStrictEqual({ value: 'Tammy McTamtam' });
  });
});
