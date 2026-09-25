import { describe, expect, test, vi } from "vitest";
import { createResponse } from "#/response";

describe("response internals", () => {
  test("reports non-Error JSON parser failures", () => {
    const response = createResponse({
      method: "GET",
      requestUrl: "https://example.com/request",
      responseUrl: "https://example.com/response",
      statusCode: 200,
      headers: {},
      body: Buffer.from("{}"),
    });
    const parse = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "parser failed";
    });

    try {
      expect(() => response.getJSON()).toThrow(
        "Non-Error thrown while parsing JSON (string)",
      );
    } finally {
      parse.mockRestore();
    }
  });
});
