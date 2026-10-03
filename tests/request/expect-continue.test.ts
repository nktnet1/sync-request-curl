import { describe, expect, test } from "vitest";
import request from "#/index";
import native from "#/native/index";
import { EXPECT_CONTINUE_SERVER_URL } from "#tests/app/config";

const url = `${EXPECT_CONTINUE_SERVER_URL}/upload`;
// Exceed libcurl's threshold for automatically adding Expect: 100-continue.
const body = Buffer.alloc(1024 * 1024 + 1, "x");

describe("automatic Expect rejection retries", () => {
  test.each([
    { name: "unauthenticated POST", method: "POST", options: {} },
    {
      name: "Basic PUT",
      method: "PUT",
      options: { auth: { username: "user", password: "secret" } },
    },
    {
      name: "Bearer POST",
      method: "POST",
      options: { auth: { bearer: "token" } },
    },
  ] as const)(
    "returns the successful retry for $name",
    ({ method, options }) => {
      for (const timeout of [0, 1_000]) {
        const response = request(method, url, {
          ...options,
          body,
          httpVersion: "1.1",
          timeout,
          overallTimeout: 5_000,
        });
        expect(response.statusCode).toBe(200);
        expect(response.getJSON()).toStrictEqual({
          bytes: body.length,
          expect: null,
        });
        expect(response.headers["x-rejected-expectation"]).toBeUndefined();
      }
    },
  );

  test("reports both native exchanges without authentication or a header timeout", () => {
    const response = native.request({
      method: "POST",
      url,
      headers: [],
      body,
      httpVersion: "1.1",
      noBody: false,
      timeout: 0,
      connectTimeout: 0,
      socketTimeout: 0,
      overallTimeout: 5_000,
      proxy: "",
      proxyNoProxy: "",
    });
    expect(response.transportCode).toBe(0);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toContain("HTTP/1.1 417 Expectation Failed");
    expect(response.requestHeaderOffsets).toHaveLength(2);
    const offsets = response.requestHeaderOffsets;
    if (!offsets) throw new Error("Missing native request boundaries");
    expect(offsets[0]).toBe(0);
    expect(response.headers[offsets[1]]).toBe("HTTP/1.1 200 OK");
  });
});
