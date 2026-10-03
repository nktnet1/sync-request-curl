import { describe, expect, test } from "vitest";
import {
  hasSafeAuthCredentials,
  isSafeAuthUsername,
  isSafeBearerToken,
} from "#/http/auth";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/";

describe("authentication username validation", () => {
  test.each([
    "",
    "user",
    "caf\u00e9",
    "\u4e2d\u6587",
    "\u{1f600}",
    "\u{10ffff}",
  ])("preserves empty, ASCII, and Unicode usernames: %j", (username) => {
    expect(isSafeAuthUsername(username)).toBe(true);
  });

  test("rejects ASCII controls before or after supplementary characters", () => {
    const controls = Array.from({ length: 0x20 }, (_, code) => code);
    controls.push(0x7f);
    for (const code of controls) {
      const control = String.fromCodePoint(code);
      expect(isSafeAuthUsername(control)).toBe(false);
      expect(isSafeAuthUsername(`user${control}\u{1f600}`)).toBe(false);
      expect(isSafeAuthUsername(`\u{1f600}${control}user`)).toBe(false);
    }
  });

  test.each([undefined, "basic", "digest", "any"])(
    "rejects Basic/Digest-compatible separators and password controls for %s",
    (type) => {
      expect(hasSafeAuthCredentials("user:name", "secret", type)).toBe(false);
      expect(hasSafeAuthCredentials("user", "secret\n", type)).toBe(false);
      expect(hasSafeAuthCredentials("user", "secret\t", type)).toBe(false);
      expect(hasSafeAuthCredentials("user", "p:a:ss", type)).toBe(true);
    },
  );

  test.each(["ntlm", "negotiate"])(
    "keeps non-HTTP credential syntax for %s while rejecting native NULs",
    (type) => {
      expect(hasSafeAuthCredentials("user:name", "secret\n", type)).toBe(true);
      expect(hasSafeAuthCredentials("user\n", "secret", type)).toBe(false);
      expect(hasSafeAuthCredentials("user", "secret\0suffix", type)).toBe(
        false,
      );
    },
  );
});

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
      const character = String.fromCodePoint(code);
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
