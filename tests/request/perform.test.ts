import { describe, expect, test, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({
  nativeRequest: vi.fn(),
}));

vi.mock("#/native/index", () => ({
  default: {
    request: nativeRequest,
  },
}));

import { performRequest } from "#/request/perform";

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

  test("passes overall and socket timeouts independently to native transport", () => {
    nativeRequest.mockReturnValueOnce({
      transportCode: 0,
      transportMessage: "",
      statusCode: 204,
      effectiveUrl: "https://example.com/path",
      redirectUrl: null,
      headers: [],
      body: Buffer.alloc(0),
    });

    performRequest("GET", "https://example.com/path", {
      timeout: 900,
      socketTimeout: 125,
    });

    expect(nativeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 900, socketTimeout: 125 }),
    );
  });
});
