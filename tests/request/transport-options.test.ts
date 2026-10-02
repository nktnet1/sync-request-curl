import { Agent } from "node:http";
import { createServer } from "node:net";
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
const clientCertFile = fileURLToPath(
  new URL("../app/fixtures/tls-client-cert.pem", import.meta.url),
);
const clientKeyFile = fileURLToPath(
  new URL("../app/fixtures/tls-client-key.pem", import.meta.url),
);
const encryptedClientKeyFile = fileURLToPath(
  new URL("../app/fixtures/tls-client-key-encrypted.pem", import.meta.url),
);
const clientP12File = fileURLToPath(
  new URL("../app/fixtures/tls-client.p12", import.meta.url),
);
const clientPassphrase = "test-passphrase";

const getUnusedLoopbackPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a loopback test port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });

describe("transport option validation", () => {
  test("maps origin TLS controls", () => {
    expect(
      prepareTransportOptions({
        tls: {
          certFile: clientCertFile,
          certType: "pem",
          keyFile: clientKeyFile,
          passphrase: clientPassphrase,
          minVersion: "TLSv1.2",
          maxVersion: "TLSv1.3",
        },
      }),
    ).toMatchObject({
      tlsCertFile: clientCertFile,
      tlsCertType: "pem",
      tlsKeyFile: clientKeyFile,
      tlsKeyPassphrase: clientPassphrase,
      tlsMinVersion: "TLSv1.2",
      tlsMaxVersion: "TLSv1.3",
    });
  });

  test("maps origin credentials and bearer authentication", () => {
    expect(
      prepareTransportOptions({
        auth: { username: "user", password: "secret", type: "digest" },
      }),
    ).toMatchObject({
      authType: "digest",
      authUsername: "user",
      authPassword: "secret",
    });
    expect(
      prepareTransportOptions({ auth: { username: "user" } }),
    ).toMatchObject({
      authType: "basic",
      authUsername: "user",
      authPassword: "",
    });
    expect(
      prepareTransportOptions({ auth: { bearer: "token" } }),
    ).toMatchObject({ authType: "bearer", authBearer: "token" });
  });

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
    "http://localhost:8080",
    "https://localhost:8080",
    "socks4://localhost:1080",
    "socks4a://localhost:1080",
    "socks5://localhost:1080",
    "socks5h://localhost:1080",
  ])("accepts proxy URL scheme %s", (url) => {
    expect(prepareTransportOptions({ proxy: { url } }).proxy).toBe(
      new URL(url).href,
    );
  });

  test("maps HTTP proxy auth, bypass hosts, and proxy-only headers", () => {
    expect(
      prepareTransportOptions({
        proxy: {
          url: PROXY_URL,
          username: "user",
          password: "secret",
          auth: "digest",
          noProxy: ["localhost", "127.0.0.0/8"],
          headers: {
            "X-Proxy-Trace": "trace-id",
            "X-Proxy-Multi": ["one", "two"],
          },
        },
      }),
    ).toMatchObject({
      proxy: `${PROXY_URL}/`,
      proxyUsername: "user",
      proxyPassword: "secret",
      proxyAuth: "digest",
      proxyNoProxy: "localhost,127.0.0.0/8",
      proxyHeaders: [
        "X-Proxy-Trace: trace-id",
        "X-Proxy-Multi: one",
        "X-Proxy-Multi: two",
      ],
    });
  });

  test.each([
    { proxy: { url: "ftp://localhost" } },
    { proxy: { url: "http://localhost/path" } },
    { proxy: { url: "socks5://localhost/path" } },
    { proxy: { url: "http://localhost/?x=1" } },
    { proxy: { url: "http://localhost/#fragment" } },
    { proxy: { url: "http://u%00:p@localhost" } },
    { proxy: { url: "http://u:p%00@localhost" } },
    { proxy: { url: PROXY_URL, password: "p" } },
    { proxy: { url: "socks5://localhost", auth: "basic" as const } },
    {
      proxy: {
        url: "socks5://localhost",
        headers: { "x-proxy-test": "value" },
      },
    },
    { localAddress: "localhost" },
    { localAddress: "127.0.0.1", localInterface: "lo" },
    { localPortRange: 2 },
    { localPort: 65_535, localPortRange: 2 },
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
          auth: "any",
          noProxy: ["example.test"],
          headers: { "x-proxy-trace": "trace-id" },
        },
        rejectUnauthorized: false,
        caFile,
        localInterface: "lo",
        localPort: 40_000,
        localPortRange: 10,
        family: 6,
        tcpKeepAlive: {
          idleSeconds: 30,
          intervalSeconds: 5,
          probeCount: 3,
        },
      }),
    ).toMatchObject({
      proxy: "https://localhost:8080/",
      proxyUsername: "explicit",
      proxyPassword: "secret",
      proxyAuth: "any",
      proxyNoProxy: "example.test",
      proxyHeaders: ["x-proxy-trace: trace-id"],
      rejectUnauthorized: false,
      caFile,
      networkInterface: "if!lo",
      localPort: 40_000,
      localPortRange: 10,
      httpVersion: "auto",
      family: 6,
      tcpKeepAlive: true,
      tcpKeepIdle: 30,
      tcpKeepInterval: 5,
      tcpKeepCount: 3,
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
    expect(usesCustomTransport({ auth: { username: "user" } })).toBe(true);
    expect(usesCustomTransport({ auth: { bearer: "token" } })).toBe(true);
    expect(usesCustomTransport({ rejectUnauthorized: true })).toBe(false);
    expect(usesCustomTransport({ tcpKeepAlive: false })).toBe(false);
    expect(usesCustomTransport({ rejectUnauthorized: false })).toBe(true);
    expect(usesCustomTransport({ tcpKeepAlive: true })).toBe(true);
    expect(usesCustomTransport({ tcpKeepAlive: {} })).toBe(true);
    expect(usesCustomTransport({ tcpKeepAlive: { probeCount: 3 } })).toBe(true);
    expect(usesCustomTransport({ caFile })).toBe(true);
    expect(usesCustomTransport({ tls: {} })).toBe(true);
    expect(usesCustomTransport({ tls: { maxVersion: "TLSv1.2" } })).toBe(true);
    expect(usesCustomTransport({ httpVersion: "auto" })).toBe(false);
    expect(usesCustomTransport({ httpVersion: "2" })).toBe(true);
    expect(usesCustomTransport({ family: 0 })).toBe(false);
    expect(usesCustomTransport({ family: 4 })).toBe(true);
    expect(usesCustomTransport({ family: 6 })).toBe(true);
    expect(usesCustomTransport({ localPort: 40_000 })).toBe(true);
    expect(usesCustomTransport({ localPort: 40_000, localPortRange: 10 })).toBe(
      true,
    );
  });

  const invalidPublicOptions: Options[] = [
    { caFile: "bad\0path" },
    { tls: { certFile: "bad\0path" } },
    { tls: { keyFile: clientKeyFile } } as unknown as Options,
    { tls: { certType: "p12" } } as unknown as Options,
    { tls: { passphrase: clientPassphrase } } as unknown as Options,
    {
      tls: { certFile: clientP12File, certType: "p12", keyFile: clientKeyFile },
    } as unknown as Options,
    { tls: { minVersion: "TLSv1.3", maxVersion: "TLSv1.2" } },
    { proxy: { url: PROXY_URL, username: "bad\0", password: "" } },
    { proxy: { url: PROXY_URL, username: "", password: "bad\0" } },
    { tcpKeepAlive: { idleSeconds: 0 } },
    { tcpKeepAlive: { intervalSeconds: 1.5 } },
    { tcpKeepAlive: { probeCount: 0 } },
    { tcpKeepAlive: { probeCount: 1.5 } },
    { httpVersion: "4" } as unknown as Options,
    { family: 5 } as unknown as Options,
    { localPort: 0 },
    { localPort: 65_536 },
    { localPort: 40_000.5 },
    { localPort: 40_000, localPortRange: -1 },
  ];

  test.each(invalidPublicOptions)(
    "rejects invalid public option %j",
    (options) => {
      expect(() => request("GET", SERVER_URL, options)).toThrow(
        "Invalid request options",
      );
    },
  );
});

describe("native transport controls", () => {
  test("supports Basic HTTP authentication", () => {
    const response = request("GET", `${SERVER_URL}/auth/echo`, {
      auth: { username: "user", password: "secret" },
    });

    expect(response.getJSON()).toEqual({
      authorization: "Basic dXNlcjpzZWNyZXQ=",
    });
  });

  test("lets libcurl negotiate an allowed HTTP authentication method", () => {
    const response = request("GET", `${SERVER_URL}/auth/basic-challenge`, {
      auth: { username: "user", password: "secret", type: "any" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.getJSON()).toEqual({
      authorization: "Basic dXNlcjpzZWNyZXQ=",
    });
  });

  test("supports Bearer authentication through libcurl", () => {
    const response = request("GET", `${SERVER_URL}/auth/echo`, {
      auth: { bearer: "test-token" },
    });

    expect(response.getJSON()).toEqual({
      authorization: "Bearer test-token",
    });
  });

  test("preserves high-level auth only across same-origin redirects", () => {
    const auth = { username: "user", password: "secret" } as const;
    const sameOrigin = request(
      "GET",
      `${SERVER_URL}/auth/redirect/same-origin`,
      { auth },
    );
    const crossOrigin = request(
      "GET",
      `${SERVER_URL}/auth/redirect/cross-origin`,
      { auth },
    );

    expect(sameOrigin.getJSON()).toEqual({
      authorization: "Basic dXNlcjpzZWNyZXQ=",
    });
    expect(crossOrigin.getJSON()).toEqual({ authorization: null });
  });

  test("accepts an explicit IPv4 family selection", () => {
    expect(request("GET", SERVER_URL, { family: 4 }).statusCode).toBe(200);
  });

  test("binds an explicit local source port", async () => {
    const localPort = await getUnusedLoopbackPort();
    expect(
      request("GET", TLS_URL, {
        caFile,
        localAddress: "127.0.0.1",
        localPort,
      }).getJSON(),
    ).toMatchObject({ address: "127.0.0.1", port: localPort });
  });

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

  test.runIf(process.platform !== "darwin")(
    "presents a PKCS#12 client certificate for mutual TLS",
    () => {
      expect(
        request("GET", TLS_URL, {
          caFile,
          tls: {
            certFile: clientP12File,
            certType: "p12",
            passphrase: clientPassphrase,
          },
        }).getJSON(),
      ).toMatchObject({
        clientAuthorized: true,
        clientSubject: "sync-request-curl-client",
      });
    },
  );

  test.runIf(process.platform === "linux")(
    "unlocks an encrypted PEM client key with a passphrase",
    () => {
      expect(
        request("GET", TLS_URL, {
          caFile,
          tls: {
            certFile: clientCertFile,
            keyFile: encryptedClientKeyFile,
            passphrase: clientPassphrase,
          },
        }).getJSON(),
      ).toMatchObject({
        clientAuthorized: true,
        clientSubject: "sync-request-curl-client",
      });
    },
  );

  test("can cap the negotiated origin TLS version", () => {
    expect(
      request("GET", TLS_URL, {
        caFile,
        tls: { maxVersion: "TLSv1.2" },
      }).getJSON(),
    ).toMatchObject({ tlsProtocol: "TLSv1.2" });
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

  test("supports a per-request proxy bypass list", () => {
    const response = request("GET", SERVER_URL, {
      proxy: { url: PROXY_URL, noProxy: ["127.0.0.1"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-proxy-auth"]).toBeUndefined();
  });

  test("sends proxy-specific headers to the HTTP proxy", () => {
    const response = request("GET", SERVER_URL, {
      proxy: {
        url: PROXY_URL,
        headers: { "x-proxy-trace": "trace-id" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-proxy-trace"]).toBe("trace-id");
  });

  test("lets libcurl negotiate an allowed HTTP proxy authentication method", () => {
    const response = request("GET", SERVER_URL, {
      proxy: {
        url: PROXY_URL,
        username: "user",
        password: "secret",
        auth: "any",
        headers: { "x-proxy-require-auth": "basic" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-proxy-auth"]).toBe("Basic dXNlcjpzZWNyZXQ=");
  });

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
      proxy: {
        url: PROXY_URL,
        username: "user",
        password: "secret",
        headers: { "x-proxy-trace": "trace-id" },
      },
      caFile,
    });
    expect(response.getJSON()).toMatchObject({
      proxyAuthorization: null,
      proxyTrace: null,
    });
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

  test("handles TCP keepalive probe-count capability", () => {
    const perform = () =>
      request("GET", TLS_URL, {
        caFile,
        localAddress: "127.0.0.1",
        tcpKeepAlive: { idleSeconds: 1, intervalSeconds: 1, probeCount: 3 },
      });

    // macOS intentionally uses the system libcurl, whose version varies by OS.
    // Bundled builds on Linux and Windows use libcurl 8.21.0 and must support
    // CURLOPT_TCP_KEEPCNT.
    if (process.platform === "darwin") {
      try {
        expect(perform().getJSON()).toMatchObject({ address: "127.0.0.1" });
      } catch (error) {
        expect(error).toMatchObject({
          message:
            "Request failed: TCP keepalive probeCount requires libcurl 8.9.0 or newer and platform support",
        });
      }
      return;
    }

    expect(perform().getJSON()).toMatchObject({ address: "127.0.0.1" });
  });

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
