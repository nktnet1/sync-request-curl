import { describe, expect, test } from "vitest";
import { FormData } from "#/form-data";
import { prepareRequest } from "#/request/prepare";

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
    form.append("field", "form-value");

    const prepared = prepareRequest("https://example.com", {
      form,
      json: { source: "json" },
      body: "body-value",
    });

    expect(prepared).toMatchObject({
      form: [{ key: "field", value: "form-value" }],
    });
    expect(prepared.body).toBeUndefined();
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
