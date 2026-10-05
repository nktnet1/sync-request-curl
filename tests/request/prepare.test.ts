import { describe, expect, test } from "vitest";
import { FormData } from "#/form-data";
import { prepareRequest } from "#/request/prepare";

describe("origin URL credentials", () => {
  test.each(["user%3Aname", "user%3aname"])(
    "rejects percent-decoded colons in a Basic username: %s",
    (username) => {
      expect(() =>
        prepareRequest(`https://${username}:secret@example.com/`, {}),
      ).toThrow("Invalid URL credentials for basic authentication");
    },
  );

  test.each(
    Array.from({ length: 33 }, (_, index) => (index === 32 ? 0x7f : index)),
  )(
    "rejects percent-decoded ASCII control character %i in either credential",
    (code) => {
      const control = encodeURIComponent(String.fromCharCode(code));
      for (const userinfo of [
        `user${control}:secret`,
        `user:secret${control}`,
      ]) {
        expect(() =>
          prepareRequest(`https://${userinfo}@example.com/`, {}),
        ).toThrow("Invalid URL credentials for basic authentication");
      }
    },
  );

  test.each([
    "user%:secret",
    "user:secret%GG",
    "user%FF:secret",
    "user:secret%C3",
  ])("rejects malformed percent encoding before transport: %s", (userinfo) => {
    expect(() =>
      prepareRequest(`https://${userinfo}@example.com/`, {}),
    ).toThrow(URIError);
  });

  test.each([
    "user:p%40ss",
    "user:p%3Aa%3Ass",
    "user:secret%253A",
    "caf%C3%A9:p%C3%A4ss",
    "café:päss",
    "user",
    ":secret",
    "user:",
  ])("preserves valid URL Basic credentials: %s", (userinfo) => {
    const url = `https://${userinfo}@example.com/a/../b?q=%2f#fragment`;
    expect(prepareRequest(url, {}).url).toBe(url);
  });

  test.each(["user:secret", "user%3Aname:secret%0A", "user%:secret%FF", ""])(
    "discards dormant credentials when explicit Authorization wins: %s",
    (userinfo) => {
      expect(
        prepareRequest(
          `https://${userinfo}@example.com/a/../b?q=%2f#fragment`,
          { headers: { authorization: "Bearer explicit" } },
        ).url,
      ).toBe("https://example.com/a/../b?q=%2f#fragment");
    },
  );
});

describe("request preparation", () => {
  test("rejects JSON values that JSON.stringify cannot serialize", () => {
    expect(() =>
      Reflect.apply(prepareRequest, undefined, [
        "https://example.com",
        { json: Symbol("not-json") },
      ]),
    ).toThrow("The json option must be JSON-serializable");
  });

  test("rejects a top-level toJSON result of undefined", () => {
    expect(() =>
      Reflect.apply(prepareRequest, undefined, [
        "https://example.com",
        { json: { toJSON: () => undefined } },
      ]),
    ).toThrow("The json option must be JSON-serializable");
  });

  test("serializes JsonLike values with toJSON and nested undefined", () => {
    expect(
      prepareRequest("https://example.com", {
        json: {
          createdAt: new Date("2026-09-25T00:00:00.000Z"),
          values: [1, undefined, true],
          omitted: undefined,
        },
      }).body,
    ).toBe('{"createdAt":"2026-09-25T00:00:00.000Z","values":[1,null,true]}');
  });

  test("prefers form over JSON and body payloads", () => {
    const form = new FormData();
    form.setBoundary("test-boundary");
    form.append("field", "form-value");

    const prepared = prepareRequest("https://example.com", {
      form,
      json: { source: "json" },
      body: "body-value",
    });

    expect(prepared.body).toStrictEqual(form.getBuffer());
    expect(prepared.headers).toContain(
      "Content-Type: multipart/form-data; boundary=test-boundary",
    );
    expect(prepared.headers).toContain(
      `Content-Length: ${form.getLengthSync()}`,
    );
  });

  test("prefers JSON over body when form is absent", () => {
    const prepared = prepareRequest("https://example.com", {
      json: false,
      body: "body-value",
    });

    expect(prepared.body).toBe("false");
  });

  test.each(["GET", "DELETE", "HEAD"] as const)(
    "%s without a payload does not get a generated content-length",
    (method) => {
      const prepared = prepareRequest("https://example.com", {}, method);

      expect(
        prepared.headers.some((header) =>
          header.toLowerCase().startsWith("content-length"),
        ),
      ).toBe(false);
    },
  );

  test.each(["GET", "DELETE", "HEAD"] as const)(
    "%s keeps an explicitly supplied body",
    (method) => {
      const prepared = prepareRequest(
        "https://example.com",
        { body: "payload" },
        method,
      );

      expect(prepared.body).toBe("payload");
      expect(prepared.headers).toContain(
        `Content-Length: ${Buffer.byteLength("payload")}`,
      );
    },
  );

  test("leaves the URL unchanged for an empty query object", () => {
    expect(prepareRequest("https://example.com/path", { qs: {} }).url).toBe(
      "https://example.com/path",
    );
  });

  test("adds compression negotiation by default", () => {
    expect(prepareRequest("https://example.com", {}).headers).toContain(
      "Accept-Encoding: gzip, deflate",
    );
  });

  test("does not add compression negotiation when gzip is false", () => {
    expect(
      prepareRequest("https://example.com", { gzip: false }).headers,
    ).not.toContain("Accept-Encoding: gzip, deflate");
  });

  test("preserves a caller supplied accept-encoding header", () => {
    expect(
      prepareRequest("https://example.com", {
        headers: { "accept-encoding": "identity" },
      }).headers,
    ).toContain("accept-encoding: identity");
  });
});

test.each([
  "gzip",
  "gzip, chunked",
  "chunked, chunked",
  "",
  ["chunked", "chunked"],
])("rejects transfer coding it cannot correctly encode: %j", (value) => {
  expect(() =>
    prepareRequest("https://example.com", {
      headers: { "Transfer-Encoding": value },
      body: "payload",
    }),
  ).toThrow("only a single chunked Transfer-Encoding is supported");
});
