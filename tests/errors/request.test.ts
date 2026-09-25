import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { CurlError, RequestError, throwForTransportError } from "#/errors";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

const captureCurlError = (requestWrapped: () => void): CurlError => {
  try {
    requestWrapped();
  } catch (error) {
    return v.parse(v.instance(CurlError), error);
  }
  throw new Error("Expected request to throw CurlError");
};

const expectCurlError = (requestWrapped: () => void, code: number): void => {
  expect(captureCurlError(requestWrapped).code).toStrictEqual(code);
};

describe("request transport errors", () => {
  test("CurlError preserves the libcurl error code", () => {
    expect(new CurlError(1, "transport failure").code).toBe(1);
    expect(new CurlError(101, "transport failure").code).toBe(101);
    expect(() => new CurlError(0, "transport failure")).toThrow(Error);
    expect(() => new CurlError(102, "transport failure")).toThrow(Error);
  });

  test("RequestError preserves ErrorOptions cause semantics", () => {
    const withoutCause = new RequestError(
      "ERR_REQUEST_FAILED",
      "Request failed",
      {},
    );
    expect(Object.hasOwn(withoutCause, "cause")).toBe(false);

    const cause = new Error("underlying failure");
    const withCause = new RequestError("ERR_REQUEST_FAILED", "Request failed", {
      cause,
    });
    expect(withCause.cause).toBe(cause);
  });

  test("malformed URL", () => {
    expectCurlError(() => request("GET", ""), 3);
  });

  test("request inputs are hidden by default", () => {
    const error = captureCurlError(() =>
      request("GET", "", { headers: { authorization: "secret-token" } }),
    );

    expect(error.code).toBe(3);
    expect(error.message).not.toContain("secret-token");
    expect(error.message).not.toContain("DEBUG:");
  });

  test("request inputs are included when debug is enabled", () => {
    const error = captureCurlError(() =>
      request("GET", "", {
        debug: true,
        headers: { authorization: "secret-token" },
      }),
    );

    expect(error.code).toBe(3);
    expect(error.message).toContain("secret-token");
    expect(error.message).toContain("DEBUG:");
  });

  test("non-existent server", () => {
    expectCurlError(
      () => request("GET", "https://sync-request-curl.invalid"),
      6,
    );
  });

  test("request timeout", () => {
    expectCurlError(
      () =>
        request("POST", `${SERVER_URL}/timeout`, {
          json: { timeout: 1000 },
          timeout: 200,
        }),
      28,
    );
  });

  test.each([47, 60, 99, 101])(
    "preserves transport code %i",
    (transportCode) => {
      expectCurlError(
        () =>
          throwForTransportError(transportCode, "transport failure", {
            method: "GET",
            url: "https://example.com",
            options: {},
          }),
        transportCode,
      );
    },
  );
});
