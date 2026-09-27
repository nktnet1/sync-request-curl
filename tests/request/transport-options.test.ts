import { Agent } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import request from "#/index";
import {
  prepareTransportOptions,
  usesCustomTransport,
} from "#/request/transport-options";
import type { Options } from "#/types";
import { PROXY_URL, SERVER_URL, TLS_URL } from "#tests/app/config";

const caFile = fileURLToPath(
  new URL("../app/fixtures/tls-cert.pem", import.meta.url),
);

describe("transport option validation", () => {
  test.each([
    { proxy: PROXY_URL, username: undefined, password: undefined },
    {
      proxy: PROXY_URL.replace("://", "://user@"),
      username: "user",
      password: "",
    },
    {
      proxy: PROXY_URL.replace("://", "://:secret@"),
      username: "",
      password: "secret",
    },
  ])(
    "only configures URL proxy credentials when supplied: $proxy",
    ({ proxy, username, password }) => {
      const options = prepareTransportOptions({ proxy });
      expect(options.proxyUsername).toBe(username);
      expect(options.proxyPassword).toBe(password);
    },
  );

  test("preserves explicitly requested empty proxy credentials", () => {
    const options = prepareTransportOptions({
      proxy: PROXY_URL,
      proxyAuth: { username: "", password: "" },
    });
    expect(options.proxyUsername).toBe("");
    expect(options.proxyPassword).toBe("");
  });

  test.each([
    { proxy: "socks5://localhost" },
    { proxy: "http://localhost/path" },
    { proxy: "http://localhost/?x=1" },
    { proxy: "http://localhost/#fragment" },
    { proxy: "http://u%00:p@localhost" },
    { proxy: "http://u:p%00@localhost" },
    { proxyAuth: { username: "u", password: "p" } },
    { localAddress: "localhost" },
    { localAddress: "127.0.0.1", localInterface: "lo" },
  ])("rejects unsupported transport configuration %j", (options) => {
    expect(() => prepareTransportOptions(options)).toThrow();
  });

  test("maps explicit controls and lets separate proxy credentials take precedence", () => {
    expect(
      prepareTransportOptions({
        proxy: "https://url-user:url-pass@localhost:8080",
        proxyAuth: { username: "explicit", password: "secret" },
        rejectUnauthorized: false,
        caFile,
        localInterface: "lo",
        tcpKeepAlive: { idleSeconds: 30, intervalSeconds: 5 },
      }),
    ).toMatchObject({
      proxy: "https://localhost:8080/",
      proxyUsername: "explicit",
      proxyPassword: "secret",
      rejectUnauthorized: false,
      caFile,
      networkInterface: "if!lo",
      tcpKeepAlive: true,
      tcpKeepIdle: 30,
      tcpKeepInterval: 5,
    });
    expect(
      prepareTransportOptions({ localAddress: "::1", tcpKeepAlive: true }),
    ).toMatchObject({ networkInterface: "host!::1", tcpKeepAlive: true });
    expect(prepareTransportOptions({ tcpKeepAlive: false }).tcpKeepAlive).toBe(
      false,
    );
    expect(
      prepareTransportOptions({ tcpKeepAlive: {} }).tcpKeepIdle,
    ).toBeUndefined();
    expect(usesCustomTransport({})).toBe(false);
    expect(usesCustomTransport({ caFile })).toBe(true);
  });

  test.each([
    { caFile: "bad\0path" },
    { proxyAuth: { username: "bad\0", password: "" } },
    { proxyAuth: { username: "", password: "bad\0" } },
    { tcpKeepAlive: { idleSeconds: 0 } },
    { tcpKeepAlive: { intervalSeconds: 1.5 } },
  ])("rejects invalid public option %j", (options) => {
    expect(() => request("GET", SERVER_URL, options)).toThrow(
      "Invalid request options",
    );
  });
});

describe("native transport controls", () => {
  test("verifies TLS by default, accepts explicit trust, and supports explicit opt-out", () => {
    expect(() => request("GET", TLS_URL)).toThrow();
    for (const options of [{ caFile }, { rejectUnauthorized: false }]) {
      expect(request("GET", TLS_URL, options).statusCode).toBe(200);
    }
    expect(() =>
      request("GET", TLS_URL, { caFile: `${caFile}.missing` }),
    ).toThrow();
  });

  test.each([
    [{ proxy: PROXY_URL }, "null"],
    [
      { proxy: PROXY_URL.replace("://", "://user:p%40ss@") },
      "Basic dXNlcjpwQHNz",
    ],
    [
      {
        proxy: PROXY_URL,
        proxyAuth: { username: "user", password: "secret" },
      },
      "Basic dXNlcjpzZWNyZXQ=",
    ],
  ])(
    "routes HTTP through an explicit proxy %j",
    (options, expectedProxyAuth) => {
      const response = request("GET", SERVER_URL, options);
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-proxy-auth"]).toBe(expectedProxyAuth);
    },
  );

  test("tunnels HTTPS without passing proxy credentials to the origin", () => {
    const response = request("GET", TLS_URL, {
      proxy: PROXY_URL,
      proxyAuth: { username: "user", password: "secret" },
      caFile,
    });
    expect(response.getJSON()).toMatchObject({ proxyAuthorization: null });
  });

  test.each([false, true, { idleSeconds: 1, intervalSeconds: 1 }])(
    "supports local address binding and TCP keepalive %j",
    (tcpKeepAlive) => {
      const options: Options = {
        caFile,
        localAddress: "127.0.0.1",
        tcpKeepAlive,
      };
      expect(request("GET", TLS_URL, options).getJSON()).toMatchObject({
        address: "127.0.0.1",
      });
    },
  );

  test("custom trust does not reuse a socket opened with verification disabled", () => {
    const agent = new Agent({ keepAlive: true });
    try {
      expect(
        request("GET", TLS_URL, { agent, rejectUnauthorized: false })
          .statusCode,
      ).toBe(200);
      expect(() => request("GET", TLS_URL, { agent })).toThrow();
    } finally {
      agent.destroy();
    }
  });

  test.runIf(process.platform === "linux")(
    "binds an explicit interface",
    () => {
      expect(
        request("GET", SERVER_URL, { localInterface: "lo" }).statusCode,
      ).toBe(200);
      expect(() =>
        request("GET", SERVER_URL, {
          localInterface: "missing-test-interface",
        }),
      ).toThrow();
    },
  );
});
