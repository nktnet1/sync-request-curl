import { describe, expect, test } from "vitest";
import { isSafeBearerToken } from "#/http/auth";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/";

describe("bearer token validation", () => {
  test.each(["", "=", "===="])(
    "accepts each token character with padding %j",
    (padding) => {
      for (const character of alphabet) {
        expect(isSafeBearerToken(`${character}${padding}`)).toBe(true);
      }
      expect(isSafeBearerToken(`${alphabet}${padding}`)).toBe(true);
    },
  );

  test("rejects every other single-byte character and interior padding", () => {
    for (let code = 0; code <= 0xff; code += 1) {
      const character = String.fromCharCode(code);
      const allowed = alphabet.includes(character);
      expect(isSafeBearerToken(character)).toBe(allowed);
      expect(isSafeBearerToken(`a${character}b`)).toBe(allowed);
    }
  });

  test.each(["", "=", "===", "=token", "token=middle", "token= ="])(
    "rejects empty tokens and misplaced padding: %j",
    (value) => {
      expect(isSafeBearerToken(value)).toBe(false);
    },
  );

  test.each(["\u0100", "\u2028", "\u2029", "\ud800", "\udc00", "\ud83d\ude00"])(
    "rejects non-ASCII characters even after padding: %j",
    (character) => {
      expect(isSafeBearerToken(`token${character}`)).toBe(false);
      expect(isSafeBearerToken(`token===${character}`)).toBe(false);
    },
  );

  test("handles long padding runs with valid and invalid endings", () => {
    const padding = "=".repeat(100_000);
    expect(isSafeBearerToken(`token${padding}`)).toBe(true);
    expect(isSafeBearerToken(padding)).toBe(false);
    // The previous unanchored suffix regex retried every '=' for these inputs.
    for (const ending of ["a", "!", "\r", "\n", "\r\n"]) {
      expect(isSafeBearerToken(`token${padding}${ending}`)).toBe(false);
    }
  });
});
