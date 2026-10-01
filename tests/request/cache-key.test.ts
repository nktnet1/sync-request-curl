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
    { caFile: "/ca.pem" },
    { httpVersion: "2" },
    { family: 4 },
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
    }),
  ).toBe(true);
});
