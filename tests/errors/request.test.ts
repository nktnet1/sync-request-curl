import { describe, expect, test } from "vitest";
import { CurlError, RequestError, throwForTransportError } from "#/errors";
import request from "#/index";
import { SERVER_URL } from "../app/config";

const expectCurlError = (
  requestWrapped: () => void,
  code: CurlError["code"],
): void => {
  let error: unknown;
  try {
    requestWrapped();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(CurlError);
  expect((error as CurlError).code).toStrictEqual(code);
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
    let error: unknown;
    try {
      request("GET", "", { headers: { authorization: "secret-token" } });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CurlError);
    expect((error as CurlError).code).toBe(3);
    expect((error as Error).message).not.toContain("secret-token");
    expect((error as Error).message).not.toContain("DEBUG:");
  });

  test("request inputs are included when debug is enabled", () => {
    let error: unknown;
    try {
      request("GET", "", {
        debug: true,
        headers: { authorization: "secret-token" },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CurlError);
    expect((error as CurlError).code).toBe(3);
    expect((error as Error).message).toContain("secret-token");
    expect((error as Error).message).toContain("DEBUG:");
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
