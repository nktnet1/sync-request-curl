import { describe, expect, test } from "vitest";
import { serializeProxyHeaders } from "#/http/headers";
import request from "#/index";
import { PROXY_URL, SERVER_URL } from "#tests/app/config";
import { expectRejectedBeforeNativeIo } from "#tests/request/helpers";

const framingHeaders = [
  "Content-Length",
  "cOnTeNt-LeNgTh",
  "Transfer-Encoding",
  "tRaNsFeR-EnCoDiNg",
];

describe("proxy request framing", () => {
  test.each(framingHeaders)("rejects %s before native I/O", (name) => {
    for (const value of ["999", "chunked", "", ["0", "1"]]) {
      for (const method of ["GET", "POST"] as const) {
        expectRejectedBeforeNativeIo(
          () =>
            request(method, SERVER_URL, {
              body: method === "POST" ? "abc" : undefined,
              proxy: { url: PROXY_URL, headers: { [name]: value } },
            }),
          "Content-Length and Transfer-Encoding cannot be supplied in proxy.headers",
        );
      }
    }
  });

  test("uses ordinary header serialization for safe proxy headers", () => {
    expect(
      serializeProxyHeaders({ "X-Proxy": ["first", "second"], "X-Empty": "" }),
    ).toStrictEqual(["X-Proxy: first", "X-Proxy: second", "X-Empty;"]);
    expect(() =>
      serializeProxyHeaders({ "X-Proxy": "bad\r\nHeader: injected" }),
    ).toThrow();
    // An empty array emits no field at all, unlike an explicit empty value.
    expect(serializeProxyHeaders({ "Content-Length": [] })).toHaveLength(0);
  });
});

describe("proxy credential header isolation", () => {
  test.each(["Authorization", "aUtHoRiZaTiOn", "Cookie", "cOoKiE"])(
    "rejects %s before a cross-origin redirect can forward it",
    (name) => {
      expectRejectedBeforeNativeIo(
        () =>
          request("GET", `${SERVER_URL}/auth/redirect/cross-origin`, {
            proxy: { url: PROXY_URL, headers: { [name]: "secret" } },
          }),
        "Authorization and Cookie cannot be supplied in proxy.headers",
      );
    },
  );

  test.each([
    { url: PROXY_URL, username: "user" },
    { url: PROXY_URL.replace("://", "://user:secret@") },
    { url: PROXY_URL.replace("://", "://@") },
    { url: PROXY_URL.replace("://", "://:@") },
    { url: PROXY_URL, auth: "negotiate" as const },
  ])("rejects Proxy-Authorization with structured proxy auth %j", (proxy) => {
    expectRejectedBeforeNativeIo(
      () =>
        request("GET", SERVER_URL, {
          proxy: {
            ...proxy,
            headers: { "Proxy-Authorization": "Basic dXNlcjpwYXNz" },
          },
        }),
      "Proxy-Authorization cannot be combined with structured proxy authentication",
    );
  });

  test("allows an explicit Proxy-Authorization header without structured auth", () => {
    const authorization = "Basic dXNlcjpwYXNz";
    const response = request("GET", SERVER_URL, {
      proxy: {
        url: PROXY_URL,
        headers: { "Proxy-Authorization": authorization },
      },
    });
    expect(response.headers["x-proxy-auth"]).toBe(authorization);
  });
});
