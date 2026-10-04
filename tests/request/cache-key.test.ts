import { expect, test } from "vitest";
import { canUseRequestCache, getRequestCacheKey } from "#/request/cache-key";
import type { Options } from "#/types/definition";

test("cache targets ignore fragments, credentials, and default ports", () => {
  expect(
    getRequestCacheKey("http://user:pass@EXAMPLE.com:80/path#one", {}),
  ).toBe(getRequestCacheKey("http://example.com/path#two", {}));
  expect(
    getRequestCacheKey("http://example.com", { cacheNamespace: "a" }),
  ).not.toBe(getRequestCacheKey("http://example.com", { cacheNamespace: "b" }));
});

test.each([
  ["/dir/%2e%2e/resource", "/resource"],
  ["/dir/.%2e/resource", "/resource"],
  ["/dir/%2E/resource", "/dir/resource"],
  ["/dir/%2e/resource", "/dir/%252e/resource"],
  ["/a\\b", "/a/b"],
  ["/resource?", "/resource"],
  ["/resource?q=%2e", "/resource?q=."],
])("cache targets keep distinct wire paths and queries: %s, %s", (a, b) => {
  expect(getRequestCacheKey(`http://example.com${a}`, {})).not.toBe(
    getRequestCacheKey(`http://example.com${b}`, {}),
  );
});

test.each([
  ["", "/"],
  ["?q=one", "/?q=one"],
  ["/dir/../resource", "/resource"],
  ["/dir/./resource", "/dir/resource"],
  ["/dir/.", "/dir/"],
  ["/dir/..", "/"],
  ["/../../resource", "/resource"],
  ["/dir//../resource", "/dir/resource"],
  ["/dir/%2e/../resource?q=%2e#fragment", "/dir/resource?q=%2e"],
])("cache targets normalize literal dot segments: %s, %s", (a, b) => {
  expect(getRequestCacheKey(`http://example.com${a}`, {})).toBe(
    getRequestCacheKey(`http://example.com${b}`, {}),
  );
});

test("unconventional URL forms cannot alias conventional cache targets", () => {
  expect(getRequestCacheKey("http:example.com/path", {})).not.toBe(
    getRequestCacheKey("http://example.com/path", {}),
  );
});

test.each([
  { url: "http://user@example.com", headers: [], options: {} },
  { url: "http://:pass@example.com", headers: [], options: {} },
  ...["Authorization", "Cookie", "Proxy-Authorization", "Host", "hOsT"].map(
    (name) => ({
      url: "http://example.com",
      headers: [`${name}: secret`],
      options: {},
    }),
  ),
  ...[
    { body: "" },
    { json: null },
    { form: {} },
    { auth: { username: "user", password: "secret" } },
    { auth: { bearer: "token" } },
    { caFile: "/ca.pem" },
    { tls: { maxVersion: "TLSv1.2" } },
    { tls: { certFile: "/client.pem", keyFile: "/client-key.pem" } },
    { httpVersion: "2" },
    { family: 4 },
    { localPort: 40_000 },
    { localPort: 40_000, localPortRange: 10 },
    { tcpKeepAlive: { probeCount: 3 } },
  ].map((options) => ({
    url: "http://example.com",
    headers: [],
    options,
  })),
])(
  "does not cache personalized or transport-specific requests %j",
  ({ url, headers, options }) => {
    expect(canUseRequestCache(url, headers, options as Options)).toBe(false);
  },
);

test("ordinary anonymous requests can use a private application cache", () => {
  expect(canUseRequestCache("http://example.com", [], {})).toBe(true);
  expect(
    canUseRequestCache("http://example.com", [], {
      rejectUnauthorized: true,
      tcpKeepAlive: false,
      family: 0,
      maxDownloadSpeed: 1_000_000,
      maxUploadSpeed: 500_000,
    }),
  ).toBe(true);
});
