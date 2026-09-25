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
import { performRequest } from "#/request/perform";
import type { RetryResponse } from "#/types";

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

  test("supports a function-valued retry policy with one-based attempts", () => {
    nativeRequest
      .mockReturnValueOnce(nativeResponse({ statusCode: 503 }))
      .mockReturnValueOnce(nativeResponse());
    const retry = vi.fn(
      (
        error: Error | null,
        response: RetryResponse | undefined,
        attemptNumber: number,
      ) => {
        expect(error).toBeNull();
        return response?.statusCode === 503 && attemptNumber === 1;
      },
    );

    const response = request("GET", "https://example.com/retry", {
      retry,
      retryDelay: 0,
      maxRetries: 3,
    });

    expect(response.statusCode).toBe(200);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry.mock.calls.map((call) => call[2])).toEqual([1, 2]);
  });

  test("lets a function-valued retry policy reject the default HTTP retry", () => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));
    const retry = vi.fn(() => false);

    const response = request("GET", "https://example.com/retry", {
      retry,
      maxRetries: 5,
    });

    expect(response.statusCode).toBe(503);
    expect(retry).toHaveBeenCalledOnce();
    expect(nativeRequest).toHaveBeenCalledOnce();
  });

  test("propagates errors thrown by a function-valued retry policy", () => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));

    expect(() =>
      request("GET", "https://example.com/retry", {
        retry: () => {
          throw new Error("retry policy failed");
        },
        maxRetries: 1,
      }),
    ).toThrow("retry policy failed");
    expect(nativeRequest).toHaveBeenCalledOnce();
  });

  test("passes transport errors to a function-valued retry policy", () => {
    nativeRequest
      .mockReturnValueOnce(
        nativeResponse({
          transportCode: 7,
          transportMessage: "Could not connect",
          statusCode: 0,
          body: Buffer.alloc(0),
        }),
      )
      .mockReturnValueOnce(nativeResponse());
    const retry = vi.fn(
      (
        error: Error | null,
        _response: RetryResponse | undefined,
        attemptNumber: number,
      ) => error !== null && attemptNumber === 1,
    );

    const response = request("GET", "https://example.com/retry", {
      retry,
      retryDelay: 0,
      maxRetries: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry.mock.calls[0]?.[0]).toMatchObject({ code: 7 });
    expect(retry.mock.calls[0]?.[1]).toBeUndefined();
    expect(retry.mock.calls[0]?.[2]).toBe(1);
    expect(retry.mock.calls[1]?.[0]).toBeNull();
    expect(retry.mock.calls[1]?.[1]?.statusCode).toBe(200);
    expect(retry.mock.calls[1]?.[2]).toBe(2);
  });

  test("supports a function-valued retry delay with retry context", () => {
    nativeRequest
      .mockReturnValueOnce(nativeResponse({ statusCode: 503 }))
      .mockReturnValueOnce(nativeResponse());
    const wait = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    const retryDelay = vi.fn(
      (
        error: Error | null,
        response: RetryResponse | undefined,
        attemptNumber: number,
      ) => {
        expect(error).toBeNull();
        expect(response?.statusCode).toBe(503);
        expect(attemptNumber).toBe(1);
        return 23;
      },
    );

    const response = request("GET", "https://example.com/retry", {
      retry: true,
      retryDelay,
      maxRetries: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(retryDelay).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
    expect(wait.mock.calls[0]?.[3]).toBe(23);
  });

  test("rejects invalid values returned by a retry delay function", () => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));

    expect(() =>
      request("GET", "https://example.com/retry", {
        retry: true,
        retryDelay: () => Number.NaN,
        maxRetries: 1,
      }),
    ).toThrow("retryDelay must resolve to a finite non-negative number");
    expect(nativeRequest).toHaveBeenCalledOnce();
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

  test("does not invoke a function-valued retry policy for non-GET requests", () => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));
    const retry = vi.fn(() => true);

    const response = request("POST", "https://example.com/retry", {
      retry,
      retryDelay: 0,
      maxRetries: 5,
    });

    expect(response.statusCode).toBe(503);
    expect(retry).not.toHaveBeenCalled();
    expect(nativeRequest).toHaveBeenCalledOnce();
  });
});
