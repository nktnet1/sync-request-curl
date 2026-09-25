import { describe, expect, test } from "vitest";
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

  test("leaves the URL unchanged for an empty query object", () => {
    expect(prepareRequest("https://example.com/path", { qs: {} }).url).toBe(
      "https://example.com/path",
    );
  });
});
