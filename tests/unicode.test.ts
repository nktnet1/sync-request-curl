import { SERVER_URL } from './app/config';
import request, { HttpVerb } from '../src';

// import request, { HttpVerb } from 'sync-request';

describe.each([
  '😂',
  '🥲',
  '👨‍🏫',
  '🫨',
  '👨‍👨‍👧‍👦',
  '❤️‍🔥',
  '🥲 - 🙃 - 😀 - 🥰',
  'こんにちは, नमस्ते, مرحبًا, 你好, Γειά σας, שלום, Привет, გამარჯობა',
])('Unicode characters: %s', (emoji) => {
  test.each([
    { method: 'GET', route: '/get', key: 'qs' },
    { method: 'POST', route: '/post', key: 'json' },
  ])('Method=$method, route=$route, key=$key', ({ method, route, key }) => {
    const res = request(method as HttpVerb, `${SERVER_URL + route}`, { [key]: { value: emoji } });
    expect(JSON.parse(res.body.toString())).toStrictEqual({ value: emoji });
  });
});
