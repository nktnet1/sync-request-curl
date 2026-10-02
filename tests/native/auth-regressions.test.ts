import { describe, expect, test } from "vitest";
import native from "#/native/index";
import { FRAMING_SERVER_URL } from "#tests/app/config";

const base = {
  method: "GET",
  url: `${FRAMING_SERVER_URL}/regressions/auth`,
  headers: [],
  noBody: false,
  timeout: 1_000,
  connectTimeout: 0,
  overallTimeout: 2_000,
  socketTimeout: 0,
};

describe("native credential validation", () => {
  test.each([
    { authType: "bearer" as const, authBearer: "token\r\nX-Injected: yes" },
    { authType: "bearer" as const, authBearer: "token\n" },
    { authType: "bearer" as const, authBearer: "" },
    { authType: "digest" as const, authUsername: "user\r\nX-Injected: yes" },
    { proxyAuth: "digest" as const, proxyUsername: "user\n" },
    { authPassword: "secret\0suffix" },
    { proxyPassword: "secret\0suffix" },
  ])(
    "rejects credentials even when called without the public schema: %j",
    (options) => {
      expect(() => native.request({ ...base, ...options })).toThrow();
    },
  );

  test.each(["any", "digest", "ntlm", "negotiate"] as const)(
    "rejects negotiated HEAD payloads at the native boundary: %s",
    (authType) => {
      expect(() =>
        native.request({
          ...base,
          method: "HEAD",
          noBody: true,
          body: "abc",
          authType,
          authUsername: "user",
          authPassword: "secret",
        }),
      ).toThrow(
        "HEAD requests with a payload cannot use negotiated authentication",
      );
      expect(() =>
        native.request({
          ...base,
          method: "HEAD",
          noBody: true,
          form: [],
          proxyAuth: authType,
          proxy: FRAMING_SERVER_URL,
          proxyUsername: "user",
          proxyPassword: "secret",
        }),
      ).toThrow(
        "HEAD requests with a payload cannot use negotiated authentication",
      );
    },
  );
});

test("authentication timeouts do not poison a reusable native connection pool", () => {
  const connectionPoolId = native.createConnectionPool(1);
  const options = {
    ...base,
    connectionPoolId,
    authType: "any" as const,
    authUsername: "user",
    authPassword: "secret",
  };
  try {
    const timedOut = native.request({
      ...options,
      url: `${base.url}?headersDelay=900`,
      timeout: 250,
    });
    expect(timedOut.transportCode).toBe(28);
    const succeeded = native.request(options);
    expect(succeeded.transportCode).toBe(0);
    expect(succeeded.statusCode).toBe(200);
  } finally {
    native.releaseConnectionPool(connectionPoolId);
  }
});
