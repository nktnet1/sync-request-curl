import { SERVER_URL } from './app/config';
import request from '../src';

describe('Emojis', () => {
  test.each([
    '😂',
    '🥲',
    '👨‍🏫',
    '🫨',
    '👨‍👨‍👧‍👦',
    '❤️‍🔥',
  ])('Testing emoji: %s', (emoji) => {
    const res = request('GET', `${SERVER_URL}/get`, { qs: { value: emoji } });
    const body = res.body.toString();
    expect(JSON.parse(body)).toStrictEqual({ value: emoji });
  });
});
