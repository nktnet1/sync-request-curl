import { describe, expect, test, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({
  nativeRequest: vi.fn(),
}));

vi.mock("#/native", () => ({
  default: {
    request: nativeRequest,
  },
}));

import { FormData, getFormDataEntries } from "#/form-data";
import { performRequest } from "#/request/perform";
import { prepareRequest } from "#/request/prepare";
import { createResponse } from "#/response";

describe("FormData internals", () => {
  test("rejects values that are not library FormData instances", () => {
    expect(() => getFormDataEntries({} as FormData)).toThrow(
      "Expected a FormData instance created by sync-request-curl",
    );
  });

  test("rejects append calls with an invalid receiver", () => {
    expect(() =>
      FormData.prototype.append.call({} as FormData, "field", "value"),
    ).toThrow("Expected a FormData instance created by sync-request-curl");
  });
});

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

describe("single request execution", () => {
  test("falls back to the prepared URL when native effectiveUrl is null", () => {
    nativeRequest.mockReturnValueOnce({
      transportCode: 0,
      transportMessage: "",
      statusCode: 204,
      effectiveUrl: null,
      redirectUrl: null,
      headers: [],
      body: Buffer.alloc(0),
    });

    const result = performRequest("GET", "https://example.com/path", {});

    expect(result.response.url).toBe("https://example.com/path");
  });
});
