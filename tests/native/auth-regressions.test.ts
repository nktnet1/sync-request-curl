import { describe, expect, test } from "vitest";
import native from "#/native/index";
import { FRAMING_SERVER_URL, PROXY_URL, SERVER_URL } from "#tests/app/config";

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
    { authType: "basic" as const, authUsername: "user:name" },
    { authType: "digest" as const, authUsername: "user:name" },
    { authType: "any" as const, authUsername: "user:name" },
    { authType: "basic" as const, authPassword: "secret\n" },
    { proxyAuth: "digest" as const, proxyUsername: "user:name" },
    { proxyAuth: "any" as const, proxyPassword: "secret\t" },
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

describe("native proxy framing and response boundaries", () => {
  test.each([
    "Content-Length: 3",
    "content-length;",
    "Transfer-Encoding: chunked",
    "TRANSFER-ENCODING:",
  ])("rejects framing outside the public validation layer: %s", (header) => {
    expect(() =>
      native.request({
        ...base,
        proxy: FRAMING_SERVER_URL,
        proxyHeaders: [header],
      }),
    ).toThrow(
      "Content-Length and Transfer-Encoding cannot be supplied in proxy.headers",
    );
  });

  test.each(["Authorization: Bearer secret", "Cookie: session=secret"])(
    "rejects origin-sensitive proxy headers outside public validation: %s",
    (header) => {
      expect(() =>
        native.request({
          ...base,
          proxy: PROXY_URL,
          proxyHeaders: [header],
        }),
      ).toThrow("Authorization and Cookie cannot be supplied in proxy.headers");
    },
  );

  test("rejects Proxy-Authorization combined with native structured proxy auth", () => {
    expect(() =>
      native.request({
        ...base,
        proxy: PROXY_URL,
        proxyUsername: "user",
        proxyPassword: "secret",
        proxyHeaders: ["Proxy-Authorization: Basic dXNlcjpwYXNz"],
      }),
    ).toThrow(
      "Proxy-Authorization cannot be combined with structured proxy authentication",
    );
  });

  test("allows manual Proxy-Authorization without structured proxy auth", () => {
    const response = native.request({
      ...base,
      url: SERVER_URL,
      proxy: PROXY_URL,
      proxyHeaders: ["Proxy-Authorization: Basic dXNlcjpwYXNz"],
    });
    expect(response.transportCode).toBe(0);
    expect(response.statusCode).toBe(200);
  });

  test.each([
    "X-Proxy: safe\r\nContent-Length: 999",
    "X-Proxy: safe\nTransfer-Encoding: chunked",
    "X-Proxy: value\0",
  ])("rejects injected native proxy header lines: %j", (header) => {
    expect(() =>
      native.request({
        ...base,
        proxy: FRAMING_SERVER_URL,
        proxyHeaders: [header],
      }),
    ).toThrow("Invalid proxy header line");
  });

  test.each([
    { name: "unauthenticated", options: {} },
    {
      name: "Basic",
      options: {
        authType: "basic" as const,
        authUsername: "user",
        authPassword: "secret",
      },
    },
    {
      name: "Bearer",
      options: { authType: "bearer" as const, authBearer: "token" },
    },
    {
      name: "proxy Basic",
      options: {
        proxy: PROXY_URL,
        proxyUsername: "user",
        proxyPassword: "secret",
      },
    },
  ])(
    "reports request boundaries for ordinary $name requests",
    ({ options }) => {
      const response = native.request({
        ...base,
        url: `${SERVER_URL}/auth/echo`,
        ...options,
      });
      expect(response.transportCode).toBe(0);
      expect(response.requestHeaderOffsets).toStrictEqual([0]);
    },
  );

  test.each([0, 1_000])(
    "reports accepted Digest probe boundaries with timeout=%i",
    (timeout) => {
      const response = native.request({
        ...base,
        method: "POST",
        url: `${FRAMING_SERVER_URL}/regressions/rate/upload`,
        body: "abc",
        authType: "digest",
        authUsername: "user",
        authPassword: "secret",
        timeout,
      });
      expect(response.transportCode).toBe(0);
      expect(response.body.toString()).toBe(JSON.stringify({ bytes: 3 }));
      expect(response.requestHeaderOffsets).toHaveLength(2);
      expect(response.requestHeaderOffsets?.[0]).toBe(0);
      for (const offset of response.requestHeaderOffsets ?? []) {
        expect(response.headers[offset]).toMatch(/^HTTP\/\S+ 200/);
      }
    },
  );
});
