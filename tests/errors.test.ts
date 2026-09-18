import { describe, expect, test } from "vitest";
import request from "../src";
import { CurlError } from "../src/errors";
import { SERVER_URL } from "./app/config";

const checkCurlError = (requestWrapped: () => void, code: number): void => {
  let error: unknown;
  try {
    requestWrapped();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(CurlError);
  expect((error as CurlError).code).toStrictEqual(code);
};

describe("CurlError class", () => {
  test.each([100, 101])("accepts modern Libcurl error code %i", (code) => {
    expect(new CurlError(code, `Error ${code}`).code).toStrictEqual(code);
  });

  test("new CurlError code > 101", () => {
    expect(() => new CurlError(102, "Error 102")).toThrow(Error);
  });

  test("new CurlError code < 1", () => {
    expect(() => new CurlError(0, "Error 0")).toThrow(Error);
    expect(() => new CurlError(-1, "Error 0")).toThrow(Error);
  });
});

describe("Requests that give Libcurl error", () => {
  test("Malformed URL (not properly formatted)", () => {
    checkCurlError(() => request("GET", ""), 3);
  });

  test("Curl easy handle is closed when a request fails", () => {
    let isOpen: boolean | undefined;
    let handle: { readonly isOpen: boolean } | undefined;

    expect(() =>
      request("GET", "", {
        setEasyOptions: (curl) => {
          handle = curl;
          isOpen = curl.isOpen;
        },
      }),
    ).toThrow(CurlError);

    expect(isOpen).toBe(true);
    expect(handle?.isOpen).toBe(false);
  });

  test("Request inputs are hidden by default", () => {
    let error: unknown;
    try {
      request("GET", "", { headers: { authorization: "secret-token" } });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CurlError);
    expect((error as Error).message).not.toContain("secret-token");
    expect((error as Error).message).not.toContain("DEBUG:");
  });

  test("Request inputs are included when debug is enabled", () => {
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
    expect((error as Error).message).toContain("secret-token");
    expect((error as Error).message).toContain("DEBUG:");
  });

  test("Request non-existent server - CURLE_COULDNT_RESOLVE_HOST (6)", () => {
    const invalidUrl = "https://sync-request-curl.invalid";
    checkCurlError(() => request("GET", invalidUrl), 6);
  });

  test("Timeout after 1 second - CURLE_OPERATION_TIMEDOUT (28)", () => {
    const timeoutRequest = () =>
      request("POST", `${SERVER_URL}/timeout`, {
        json: { timeout: 1000 },
        timeout: 200,
      });
    checkCurlError(timeoutRequest, 28);
  });
});

describe("Other errors", () => {
  test("getBody() throw error for 401 status code", () => {
    const value = "header";
    const res = request("DELETE", `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res.statusCode).toBe(401);
    expect(() => res.getBody()).toThrow(Error);
  });

  test("getBody() throw error for 404 status code", () => {
    const res = request("DELETE", `${SERVER_URL}/unknown`);
    expect(res.statusCode).toBe(404);
    expect(() => res.getBody()).toThrow(Error);
  });
});
