import { describe, expect, test } from "vitest";
import { digestFields } from "#tests/app/regressions";

describe("Digest regression fixture parsing", () => {
  test("parses quoted and unquoted credentials", () => {
    expect(
      digestFields(
        'Digest username="user", realm="transport-regression", nonce="first-nonce", uri="/regressions/auth?scheme=digest", response="abcdef", qop=auth, nc=00000001, cnonce="test", algorithm=MD5',
      ),
    ).toEqual({
      username: "user",
      realm: "transport-regression",
      nonce: "first-nonce",
      uri: "/regressions/auth?scheme=digest",
      response: "abcdef",
      qop: "auth",
      nc: "00000001",
      cnonce: "test",
      algorithm: "MD5",
    });
  });

  test("preserves quoted delimiters and decodes quoted-pair escapes", () => {
    expect(
      digestFields(
        String.raw`Digest username="u\"ser", realm="left,right", uri="/?a=b,c=d", cnonce="a\\b", opaque=""`,
      ),
    ).toEqual({
      username: 'u"ser',
      realm: "left,right",
      uri: "/?a=b,c=d",
      cnonce: "a\\b",
      opaque: "",
    });
  });

  test("accepts optional whitespace and case-insensitive parameter names", () => {
    expect(
      digestFields('Digest \t USERNAME \t= \t"user" \t, \tqop \t= auth \t'),
    ).toEqual({ username: "user", qop: "auth" });
  });

  test.each([
    "",
    "Digest ",
    'Basic username="user"',
    'Digest ! username="user"',
    "Digest missing_equals",
    "Digest =value",
    "Digest username=",
    'Digest username="unterminated',
    'Digest username="dangling\\',
    'Digest username="user"suffix',
    'Digest username="user" qop=auth',
    'Digest username="user", garbage, qop=auth',
    'Digest username="user",, qop=auth',
    'Digest username="user", username="other"',
    'Digest username="user", USERNAME="other"',
    'Digest username="user\n"',
    'Digest username="user"\r\n',
    'Digest username="user"\n',
  ])("rejects malformed or duplicate parameters: %j", (authorization) => {
    expect(digestFields(authorization)).toEqual({});
  });

  test("does not interpret parameter names as inherited object properties", () => {
    const fields = digestFields(
      'Digest __proto__="value", constructor="other", username="user"',
    );
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(fields, "__proto__")?.value).toBe(
      "value",
    );
    expect(fields.constructor).toBe("other");
    expect(fields.username).toBe("user");
  });

  test("does not reuse regex position or fields across calls", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(digestFields('Digest username="user", qop=auth')).toEqual({
        username: "user",
        qop: "auth",
      });
      expect(digestFields("Digest malformed")).toEqual({});
      expect(digestFields('Digest nonce="second-nonce"')).toEqual({
        nonce: "second-nonce",
      });
    }
  });

  test("rejects long malformed keys and unterminated quoted values", () => {
    const longValue = "a".repeat(100_000);
    expect(digestFields(`Digest ${longValue}`)).toEqual({});
    expect(digestFields(`Digest username="${longValue}`)).toEqual({});
    expect(
      digestFields(`Digest username="user", ${longValue}, qop=auth`),
    ).toEqual({});
  });
});
