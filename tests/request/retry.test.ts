import { afterEach, describe, expect, test, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({
  nativeRequest: vi.fn(),
}));

vi.mock("#/native/index", () => ({
  default: {
    request: nativeRequest,
  },
}));

import request from "#/request/index";

const nativeResponse = (
  overrides: Partial<{
    transportCode: number;
    transportMessage: string;
    statusCode: number;
    body: Buffer;
  }> = {},
) => ({
  transportCode: 0,
  transportMessage: "",
  statusCode: 200,
  effectiveUrl: "https://example.com/retry",
  redirectUrl: null,
  headers: [],
  body: Buffer.from("ok"),
  ...overrides,
});

afterEach(() => {
  nativeRequest.mockReset();
  vi.restoreAllMocks();
});

describe("request retries", () => {
  test("does not retry GET requests unless retry is enabled", () => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));

    const response = request("GET", "https://example.com/retry");

    expect(response.statusCode).toBe(503);
    expect(nativeRequest).toHaveBeenCalledOnce();
  });

  test("uses the default retry count and delay for HTTP errors", () => {
    nativeRequest.mockReturnValue(
      nativeResponse({ statusCode: 503, body: Buffer.from("unavailable") }),
    );
    const wait = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");

    const response = request("GET", "https://example.com/retry", {
      retry: true,
    });

    expect(response.statusCode).toBe(503);
    expect(nativeRequest).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls.map((call) => call[3])).toEqual([
      200, 200, 200, 200, 200,
    ]);
  });

  test("retries transport errors up to maxRetries", () => {
    nativeRequest
      .mockReturnValueOnce(
        nativeResponse({
          transportCode: 7,
          transportMessage: "Could not connect",
          statusCode: 0,
          body: Buffer.alloc(0),
        }),
      )
      .mockReturnValueOnce(
        nativeResponse({
          transportCode: 7,
          transportMessage: "Could not connect",
          statusCode: 0,
          body: Buffer.alloc(0),
        }),
      )
      .mockReturnValueOnce(nativeResponse());

    const response = request("GET", "https://example.com/retry", {
      retry: true,
      retryDelay: 0,
      maxRetries: 2,
    });

    expect(response.statusCode).toBe(200);
    expect(nativeRequest).toHaveBeenCalledTimes(3);
  });

  test("throws the final transport error after maxRetries", () => {
    nativeRequest.mockReturnValue(
      nativeResponse({
        transportCode: 7,
        transportMessage: "Could not connect",
        statusCode: 0,
        body: Buffer.alloc(0),
      }),
    );

    expect(() =>
      request("GET", "https://example.com/retry", {
        retry: true,
        retryDelay: 0,
        maxRetries: 2,
      }),
    ).toThrow("Could not connect");
    expect(nativeRequest).toHaveBeenCalledTimes(3);
  });

  test("starts a fresh timeout budget for each retry attempt", () => {
    nativeRequest
      .mockReturnValueOnce(nativeResponse({ statusCode: 503 }))
      .mockReturnValueOnce(nativeResponse());
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(25)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025);

    const response = request("GET", "https://example.com/retry", {
      retry: true,
      retryDelay: 0,
      maxRetries: 1,
      timeout: 100,
    });

    expect(response.statusCode).toBe(200);
    expect(nativeRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ timeout: 75 }),
    );
    expect(nativeRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ timeout: 75 }),
    );
  });

  test("uses a custom retry delay", () => {
    nativeRequest
      .mockReturnValueOnce(nativeResponse({ statusCode: 400 }))
      .mockReturnValueOnce(nativeResponse());
    const wait = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");

    const response = request("GET", "https://example.com/retry", {
      retry: true,
      retryDelay: 17,
      maxRetries: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait.mock.calls[0]?.[3]).toBe(17);
  });

  test("does not retry non-GET requests", () => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));

    const response = request("POST", "https://example.com/retry", {
      retry: true,
      retryDelay: 0,
      maxRetries: 5,
    });

    expect(response.statusCode).toBe(503);
    expect(nativeRequest).toHaveBeenCalledOnce();
  });
});
