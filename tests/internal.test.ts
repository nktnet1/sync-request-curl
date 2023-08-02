import request from '../src';
import { SERVER_URL } from './config';

test('GET request valid response', () => {
  const res = request('GET', SERVER_URL, { qs: { message: 'hi' } });
  expect(res.body.toString()).toStrictEqual({ message: 'hi' });
});
