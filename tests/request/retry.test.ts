import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, test, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({
  nativeRequest: vi.fn(),
}));

vi.mock("#/native/index", () => ({
  default: {
    request: nativeRequest,
  },
}));

import { CurlError } from "#/errors";
import request from "#/index";
import { performRequest } from "#/request/perform";
import type { RetryResponse } from "#/types";

const nativeResponse = (
  overrides: Partial<{
    transportCode: number;
    transportMessage: string;
    statusCode: number;
    effectiveUrl: string | null;
    redirectUrl: string | null;
    headers: string[];
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

const transportErrorResponse = () =>
  nativeResponse({
    transportCode: 7,
    transportMessage: "Could not connect",
    statusCode: 0,
    body: Buffer.alloc(0),
  });

afterEach(() => {
  nativeRequest.mockReset();
  vi.restoreAllMocks();
});

describe("single request execution", () => {
  test("exposes the sync-request self-referencing default export", () => {
    expect(request.default).toBe(request);
    expect(request.default.FormData).toBe(request.FormData);
  });

  test.each([true, false])(
    "validates the URL before transport with followRedirects=%s",
    (followRedirects) => {
      for (const url of [
        "file:///etc/hosts",
        "ftp://example.com/file",
        "example.com",
      ]) {
        expect(() => request("GET", url, { followRedirects })).toThrow();
      }
      expect(nativeRequest).not.toHaveBeenCalled();
    },
  );

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

  test.for([
    {
      title: "surfaces captured framing errors before libcurl parser errors",
      transportMessage: "Weird server reply",
      headers: [
        "HTTP/1.1 200 OK",
        "Content-Length: 5",
        "Content-Length: 6",
        "",
      ],
      expectedError:
        "Request failed: Invalid response framing: conflicting Content-Length values",
    },
    {
      title:
        "maps libcurl Content-Length parser failures using captured framing context",
      transportMessage: "Invalid Content-Length: value",
      headers: ["HTTP/1.1 200 OK", "Content-Length: 5"],
      expectedError:
        "Request failed: Invalid response framing: conflicting Content-Length values",
    },
    {
      title: "maps an uncaptured invalid Content-Length parser failure",
      transportMessage: "Invalid Content-Length: value",
      headers: ["HTTP/1.1 200 OK"],
      expectedError:
        "Request failed: Invalid response framing: invalid Content-Length",
    },
    {
      title:
        "maps Content-Length parser failures when no status line was captured",
      transportMessage: "Invalid Content-Length: value",
      headers: ["Content-Length: 5"],
      expectedError:
        "Request failed: Invalid response framing: conflicting Content-Length values",
    },
  ])("$title", ({ transportMessage, headers, expectedError }) => {
    nativeRequest.mockReturnValueOnce(
      nativeResponse({
        transportCode: 8,
        transportMessage,
        headers,
        body: Buffer.alloc(0),
      }),
    );

    expect(() => performRequest("GET", "https://example.com/path", {})).toThrow(
      expectedError,
    );
  });

  test("preserves transport errors when captured response framing is valid", () => {
    nativeRequest.mockReturnValueOnce(
      nativeResponse({
        transportCode: 8,
        transportMessage: "Weird server reply",
        headers: ["HTTP/1.1 200 OK", "Content-Length: 5", ""],
        body: Buffer.alloc(0),
      }),
    );

    expect(() => performRequest("GET", "https://example.com/path", {})).toThrow(
      "Request failed: Weird server reply",
    );
  });
});

describe("request retries", () => {
  test.for([
    {
      title: "does not retry GET requests unless retry is enabled",
      method: "GET" as const,
      options: undefined,
    },
    {
      title: "does not retry non-GET requests",
      method: "POST" as const,
      options: { retry: true, retryDelay: 0, maxRetries: 5 },
    },
  ])("$title", ({ method, options }) => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));

    const response = request(method, "https://example.com/retry", options);

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
      .mockReturnValueOnce(transportErrorResponse())
      .mockReturnValueOnce(transportErrorResponse())
      .mockReturnValueOnce(nativeResponse());

    const response = request("GET", "https://example.com/retry", {
      retry: true,
      retryDelay: 0,
      maxRetries: 2,
    });

    expect(response.statusCode).toBe(200);
    expect(nativeRequest).toHaveBeenCalledTimes(3);
  });

  test("does not retry deterministic response framing errors", () => {
    nativeRequest.mockReturnValue(
      nativeResponse({
        transportCode: 8,
        transportMessage: "Invalid Content-Length: value",
        headers: ["HTTP/1.1 200 OK", "Content-Length: 5"],
        body: Buffer.alloc(0),
      }),
    );

    expect(() =>
      request("GET", "https://example.com/retry", {
        retry: true,
        retryDelay: 0,
        maxRetries: 2,
      }),
    ).toThrow(
      "Request failed: Invalid response framing: conflicting Content-Length values",
    );
    expect(nativeRequest).toHaveBeenCalledOnce();
  });

  test("throws the final transport error after maxRetries", () => {
    nativeRequest.mockReturnValue(transportErrorResponse());

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
      expect.objectContaining({ timeout: 100 }),
    );
    expect(nativeRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ timeout: 100 }),
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
        error: CurlError | null,
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

  test.for([
    {
      title:
        "lets a function-valued retry policy reject the default HTTP retry",
      method: "GET" as const,
      retryResult: false,
      expectedRetryCalls: 1,
    },
    {
      title:
        "does not invoke a function-valued retry policy for non-GET requests",
      method: "POST" as const,
      retryResult: true,
      expectedRetryCalls: 0,
    },
  ])("$title", ({ method, retryResult, expectedRetryCalls }) => {
    nativeRequest.mockReturnValue(nativeResponse({ statusCode: 503 }));
    const retry = vi.fn(() => retryResult);

    const response = request(method, "https://example.com/retry", {
      retry,
      retryDelay: 0,
      maxRetries: 5,
    });

    expect(response.statusCode).toBe(503);
    expect(retry).toHaveBeenCalledTimes(expectedRetryCalls);
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
      .mockReturnValueOnce(transportErrorResponse())
      .mockReturnValueOnce(nativeResponse());
    const retry = vi.fn(
      (
        error: CurlError | null,
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
    expect(retry.mock.calls[0]?.[0]).toBeInstanceOf(CurlError);
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
        error: CurlError | null,
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
});

describe("retry orchestration", () => {
  test.each([true, false])(
    "cache isolates gzip modes when the first request uses gzip=%s",
    (gzip) => {
      const url = `https://example.com/cache-gzip-${gzip}`;
      const encoded = gzipSync("decoded");
      nativeRequest.mockReturnValue(
        nativeResponse({
          effectiveUrl: url,
          headers: ["Content-Encoding: gzip", "Cache-Control: max-age=60"],
          body: encoded,
        }),
      );
      for (const mode of [gzip, !gzip, gzip, !gzip]) {
        const result = request("GET", url, {
          cache: "memory",
          gzip: mode,
          headers: { "Accept-Encoding": "gzip" },
        });
        expect(result.body).toEqual(mode ? Buffer.from("decoded") : encoded);
        expect(result.headers["content-encoding"]).toBe(
          mode ? undefined : "gzip",
        );
      }
      expect(nativeRequest).toHaveBeenCalledTimes(2);
    },
  );

  test("retries an origin response before storing a cacheable error", () => {
    const url = "https://example.com/retry-cacheable-error";
    nativeRequest.mockReturnValue(
      nativeResponse({
        statusCode: 404,
        effectiveUrl: url,
        headers: ["Cache-Control: max-age=60"],
        body: Buffer.from("missing"),
      }),
    );

    const first = request("GET", url, {
      cache: "memory",
      retry: true,
      retryDelay: 0,
      maxRetries: 1,
    });
    const second = request("GET", url, {
      cache: "memory",
      retry: true,
      retryDelay: 0,
      maxRetries: 1,
    });

    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(404);
    expect(nativeRequest).toHaveBeenCalledTimes(2);
  });

  test("does not invoke the retry policy for a fresh cached response", () => {
    const url = "https://example.com/retry-cache-hit";
    nativeRequest.mockReturnValueOnce(
      nativeResponse({
        effectiveUrl: url,
        headers: ["Cache-Control: max-age=60"],
      }),
    );

    expect(request("GET", url, { cache: "memory" }).statusCode).toBe(200);

    const retry = vi.fn(() => true);
    const cached = request("GET", url, {
      cache: "memory",
      retry,
      retryDelay: 0,
      maxRetries: 1,
    });

    expect(cached.statusCode).toBe(200);
    expect(retry).not.toHaveBeenCalled();
    expect(nativeRequest).toHaveBeenCalledOnce();
  });

  test("retries only the failing redirect hop", () => {
    const sourceUrl = "https://example.com/source";
    const targetUrl = "https://example.com/target";
    nativeRequest
      .mockReturnValueOnce(
        nativeResponse({
          statusCode: 302,
          effectiveUrl: sourceUrl,
          redirectUrl: targetUrl,
        }),
      )
      .mockReturnValueOnce(
        nativeResponse({
          statusCode: 503,
          effectiveUrl: targetUrl,
          body: Buffer.from("unavailable"),
        }),
      )
      .mockReturnValueOnce(
        nativeResponse({
          effectiveUrl: targetUrl,
          body: Buffer.from("ok"),
        }),
      );

    const response = request("GET", sourceUrl, {
      retry: true,
      retryDelay: 0,
      maxRetries: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(response.url).toBe(targetUrl);
    expect(nativeRequest.mock.calls.map(([options]) => options.url)).toEqual([
      sourceUrl,
      targetUrl,
      targetUrl,
    ]);
  });
});

describe("overall deadline and legacy options", () => {
  test("caps retry sleep at the shared overall deadline", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    nativeRequest.mockImplementation(() => {
      now += 5;
      return nativeResponse({ statusCode: 503 });
    });
    const wait = vi
      .spyOn(Atomics, "wait")
      .mockImplementation((_a, _i, _v, delay) => {
        now += Number(delay);
        return "timed-out";
      });
    expect(() =>
      request("GET", "https://example.com", {
        overallTimeout: 20,
        timeout: 100,
        retry: true,
        retryDelay: 200,
      }),
    ).toThrow("Overall timeout exceeded");
    expect(nativeRequest).toHaveBeenCalledOnce();
    expect(nativeRequest.mock.calls[0]?.[0].timeout).toBe(20);
    expect(wait.mock.calls[0]?.[3]).toBe(15);
  });

  test("shares the deadline across redirect hops", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    nativeRequest
      .mockImplementationOnce(() => {
        now = 10;
        return nativeResponse({
          statusCode: 302,
          redirectUrl: "https://example.com/next",
        });
      })
      .mockImplementationOnce(() => {
        now = 15;
        return nativeResponse();
      });
    expect(
      request("GET", "https://example.com", { overallTimeout: 40 }).statusCode,
    ).toBe(200);
    expect(
      nativeRequest.mock.calls.map(([options]) => options.timeout),
    ).toEqual([40, 30]);
  });

  test("checks a deadline with redirects disabled after synchronous work completes", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    nativeRequest.mockImplementation(() => {
      now = 20;
      return nativeResponse();
    });
    expect(() =>
      request("GET", "https://example.com", {
        overallTimeout: 10,
        followRedirects: false,
      }),
    ).toThrow("Overall timeout exceeded");
  });

  test("normalizes documented runtime sentinel values", () => {
    nativeRequest.mockReturnValue(nativeResponse());
    expect(
      Reflect.apply(request, undefined, [
        "GET",
        "https://example.com",
        {
          timeout: false,
          socketTimeout: false,
          allowRedirectHeaders: null,
        },
      ]).statusCode,
    ).toBe(200);
    expect(nativeRequest.mock.calls[0]?.[0]).toMatchObject({
      timeout: 0,
      socketTimeout: 0,
    });
  });

  test.for([false, 1, "invalid", []].map((options) => ({ options })))(
    "rejects invalid options %j",
    ({ options }) => {
      expect(() =>
        Reflect.apply(request, undefined, [
          "GET",
          "https://example.com",
          options,
        ]),
      ).toThrow("Invalid request options");
    },
  );
});
