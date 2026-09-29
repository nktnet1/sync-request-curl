import { describe, expect, test } from "vitest";
import { CurlError, RequestError } from "#/errors";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

describe("socketTimeout", () => {
  test("allows a response that keeps producing data", () => {
    const response = request("GET", `${SERVER_URL}/socket-timeout/active`, {
      socketTimeout: 200,
      timeout: 2_000,
    });

    expect(response.getBody("utf8")).toBe("012345");
  });

  test("times out when a streaming response becomes inactive", () => {
    try {
      request("GET", `${SERVER_URL}/socket-timeout/inactive`, {
        socketTimeout: 200,
        timeout: 2_000,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CurlError);
      expect((error as CurlError).code).toBe(28);
      return;
    }

    throw new Error("Expected inactive response to time out");
  });

  test("stops applying timeout after response headers arrive", () => {
    const response = request("GET", `${SERVER_URL}/socket-timeout/active`, {
      socketTimeout: 250,
      timeout: 180,
    });

    expect(response.getBody("utf8")).toBe("012345");
  });

  test("keeps overallTimeout independent from socket activity", () => {
    try {
      request("GET", `${SERVER_URL}/socket-timeout/active`, {
        socketTimeout: 250,
        timeout: 2_000,
        overallTimeout: 180,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RequestError);
      expect((error as RequestError).code).toBe("ETIMEDOUT");
      return;
    }

    throw new Error("Expected overall timeout to expire");
  });

  test("zero disables the inactivity timeout", () => {
    const response = request("GET", `${SERVER_URL}/socket-timeout/inactive`, {
      socketTimeout: 0,
      timeout: 2_000,
    });

    expect(response.getBody("utf8")).toBe("beforeafter");
  });
});
