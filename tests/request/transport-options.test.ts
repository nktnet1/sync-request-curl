import { Agent } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import request from "#/index";
import {
  prepareTransportOptions,
  usesCustomTransport,
} from "#/request/transport-options";
import type { Options } from "#/types/definition";
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
      const options = prepareTransportOptions({ proxy: { url: proxy } });
      expect(options.proxyUsername).toBe(username);
      expect(options.proxyPassword).toBe(password);
    },
  );

  test.each([
    { url: PROXY_URL, username: "user" },
    { url: PROXY_URL.replace("://", "://old:secret@"), username: "user" },
  ])("uses an empty password for an explicit username %j", (proxy) => {
    expect(prepareTransportOptions({ proxy })).toMatchObject({
      proxy: `${PROXY_URL}/`,
      proxyUsername: "user",
      proxyPassword: "",
    });
  });

  test("preserves explicitly requested empty proxy credentials", () => {
    const options = prepareTransportOptions({
      proxy: { url: PROXY_URL, username: "", password: "" },
    });
    expect(options.proxyUsername).toBe("");
    expect(options.proxyPassword).toBe("");
  });

  test("clears URL credentials when an explicit empty username is supplied", () => {
    expect(
      prepareTransportOptions({
        proxy: {
          url: PROXY_URL.replace("://", "://old:secret@"),
          username: "",
        },
      }),
    ).toMatchObject({
      proxy: `${PROXY_URL}/`,
      proxyUsername: "",
      proxyPassword: "",
    });
  });

  test.each([
    { proxy: { url: "socks5://localhost" } },
    { proxy: { url: "http://localhost/path" } },
    { proxy: { url: "http://localhost/?x=1" } },
    { proxy: { url: "http://localhost/#fragment" } },
    { proxy: { url: "http://u%00:p@localhost" } },
    { proxy: { url: "http://u:p%00@localhost" } },
    { proxy: { url: PROXY_URL, password: "p" } },
    { localAddress: "localhost" },
    { localAddress: "127.0.0.1", localInterface: "lo" },
  ])("rejects unsupported transport configuration %j", (options) => {
    expect(() => prepareTransportOptions(options)).toThrow();
  });

  test("maps explicit controls and lets separate proxy credentials take precedence", () => {
    expect(
      prepareTransportOptions({
        proxy: {
          url: "https://url-user:url-pass@localhost:8080",
          username: "explicit",
          password: "secret",
        },
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
      httpVersion: "auto",
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
    expect(usesCustomTransport({ rejectUnauthorized: true })).toBe(false);
    expect(usesCustomTransport({ tcpKeepAlive: false })).toBe(false);
    expect(usesCustomTransport({ rejectUnauthorized: false })).toBe(true);
    expect(usesCustomTransport({ tcpKeepAlive: true })).toBe(true);
    expect(usesCustomTransport({ tcpKeepAlive: {} })).toBe(true);
    expect(usesCustomTransport({ caFile })).toBe(true);
    expect(usesCustomTransport({ httpVersion: "auto" })).toBe(false);
    expect(usesCustomTransport({ httpVersion: "2" })).toBe(true);
  });

  test.each([
    { caFile: "bad\0path" },
    { proxy: { url: PROXY_URL, username: "bad\0", password: "" } },
    { proxy: { url: PROXY_URL, username: "", password: "bad\0" } },
    { tcpKeepAlive: { idleSeconds: 0 } },
    { tcpKeepAlive: { intervalSeconds: 1.5 } },
    { httpVersion: "4" } as unknown as Options,
  ])("rejects invalid public option %j", (options) => {
    expect(() => request("GET", SERVER_URL, options)).toThrow(
      "Invalid request options",
    );
  });
});

describe("native transport controls", () => {
  test.each(["1.0", "1.1"] as const)(
    "requests HTTP/%s explicitly",
    (httpVersion) => {
      expect(
        request("GET", `${SERVER_URL}/request/http-version`, {
          httpVersion,
        }).getJSON<{ httpVersion: string }>().httpVersion,
      ).toBe(httpVersion);
    },
  );

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
    [{ proxy: { url: PROXY_URL } }, "null"],
    [{ proxy: { url: PROXY_URL, username: "user" } }, "Basic dXNlcjo="],
    [
      {
        proxy: {
          url: PROXY_URL.replace("://", "://old:secret@"),
          username: "user",
        },
      },
      "Basic dXNlcjo=",
    ],
    [
      { proxy: { url: PROXY_URL.replace("://", "://user:p%40ss@") } },
      "Basic dXNlcjpwQHNz",
    ],
    [
      {
        proxy: { url: PROXY_URL, username: "user", password: "secret" },
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

  test("allows libcurl to omit authentication for all-empty credentials", () => {
    const response = request("GET", SERVER_URL, {
      proxy: {
        url: PROXY_URL.replace("://", "://old:secret@"),
        username: "",
      },
    });
    expect(response.statusCode).toBe(200);
    // libcurl builds differ on emitting Basic ':' when both fields are empty.
    // Neither outcome may retain credentials from the URL.
    expect(["null", "Basic Og=="]).toContain(response.headers["x-proxy-auth"]);
  });

  test("tunnels HTTPS without passing proxy credentials to the origin", () => {
    const response = request("GET", TLS_URL, {
      proxy: { url: PROXY_URL, username: "user", password: "secret" },
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

test("HEAD with a payload through an HTTPS tunnel returns origin headers", () => {
  const response = request("HEAD", TLS_URL, {
    body: "payload",
    proxy: { url: PROXY_URL },
    caFile,
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("application/json");
  expect(response.body).toHaveLength(0);
});
