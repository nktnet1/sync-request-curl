import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createResponse } from "#/response";

describe("response internals", () => {
  test("matches http-response-object isError status classification", () => {
    const response = createResponse({
      method: "GET",
      requestUrl: "https://example.com/request",
      responseUrl: "https://example.com/response",
      statusCode: 200,
      headers: {},
      body: Buffer.alloc(0),
    });

    expect(response.isError()).toBe(false);
    response.statusCode = 399;
    expect(response.isError()).toBe(false);
    response.statusCode = 400;
    expect(response.isError()).toBe(true);
    response.statusCode = 0;
    expect(response.isError()).toBe(true);
  });

  test("preserves the v4 getJSON default and explicit result types", () => {
    const response = createResponse({
      method: "GET",
      requestUrl: "https://example.com/request",
      responseUrl: "https://example.com/response",
      statusCode: 200,
      headers: {},
      body: Buffer.from('{"message":"hello"}'),
    });

    expectTypeOf(response.getJSON()).toBeAny();
    expectTypeOf(response.getJSON("utf-8")).toBeAny();
    expectTypeOf(response.getJSON(undefined)).toBeAny();
    expectTypeOf(response.getJSON<unknown>()).toBeUnknown();
    expectTypeOf(response.getJSON<{ message: string }>("utf-8")).toEqualTypeOf<{
      message: string;
    }>();
    expect(response.getJSON("utf-8").message).toBe("hello");
  });

  test("includes the decoded response body in getBody() status errors", () => {
    const response = createResponse({
      method: "GET",
      requestUrl: "https://example.com/request",
      responseUrl: "https://example.com/response",
      statusCode: 404,
      headers: {},
      body: Buffer.from("not found"),
    });

    expect(() => response.getBody("base64")).toThrow(
      "Server responded with status code 404:\nbm90IGZvdW5k",
    );
  });

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
