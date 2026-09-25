import { describe, expect, test } from "vitest";
import { RequestError, throwForTransportError } from "#/errors";
import request from "#/index";
import { SERVER_URL } from "../app/config";

const expectRequestError = (
  requestWrapped: () => void,
  code: RequestError["code"],
): void => {
  let error: unknown;
  try {
    requestWrapped();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(RequestError);
  expect((error as RequestError).code).toStrictEqual(code);
};

describe("request transport errors", () => {
  test("malformed URL", () => {
    expectRequestError(() => request("GET", ""), "ERR_INVALID_URL");
  });

  test("request inputs are hidden by default", () => {
    let error: unknown;
    try {
      request("GET", "", { headers: { authorization: "secret-token" } });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequestError);
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

    expect(error).toBeInstanceOf(RequestError);
    expect((error as Error).message).toContain("secret-token");
    expect((error as Error).message).toContain("DEBUG:");
  });

  test("non-existent server", () => {
    expectRequestError(
      () => request("GET", "https://sync-request-curl.invalid"),
      "ENOTFOUND",
    );
  });

  test("request timeout", () => {
    expectRequestError(
      () =>
        request("POST", `${SERVER_URL}/timeout`, {
          json: { timeout: 1000 },
          timeout: 200,
        }),
      "ETIMEDOUT",
    );
  });

  test.each([
    [47, "ERR_TOO_MANY_REDIRECTS"],
    [99, "ERR_REQUEST_FAILED"],
  ] as const)("maps transport code %i to %s", (transportCode, expectedCode) => {
    expectRequestError(
      () =>
        throwForTransportError(transportCode, "transport failure", {
          method: "GET",
          url: "https://example.com",
          options: {},
        }),
      expectedCode,
    );
  });
});
