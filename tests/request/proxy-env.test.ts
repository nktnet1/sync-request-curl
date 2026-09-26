import { afterEach, describe, expect, test, vi } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

const proxyVariables = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ambient proxy environment", () => {
  test("does not route requests through libcurl proxy environment variables", () => {
    for (const variable of proxyVariables) {
      vi.stubEnv(variable, "http://127.0.0.1:1");
    }
    vi.stubEnv("no_proxy", "");
    vi.stubEnv("NO_PROXY", "");

    const response = request("GET", SERVER_URL);

    expect(response.statusCode).toBe(200);
    expect(response.getJSON()).toStrictEqual({ message: "Hello, world!" });
  });
});
