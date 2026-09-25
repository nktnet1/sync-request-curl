import { describe, expect, test } from "vitest";
import { prepareRequest } from "#/request/prepare";

describe("request preparation", () => {
  test("rejects JSON values that JSON.stringify cannot serialize", () => {
    expect(() =>
      prepareRequest("https://example.com", {
        json: Symbol("not-json"),
      }),
    ).toThrow("The json option must be JSON-serializable");
  });

  test("leaves the URL unchanged for an empty query object", () => {
    expect(prepareRequest("https://example.com/path", { qs: {} }).url).toBe(
      "https://example.com/path",
    );
  });
});
