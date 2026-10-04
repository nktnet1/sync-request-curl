import { expect, test } from "vitest";
import {
  canUseRequestCache,
  getCacheBucketKey,
  getRequestCacheInvalidationKeys,
  getRequestCacheKey,
} from "#/request/cache-key";
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
  ["/dir/%2e/../resource?q=%2e", "/dir/resource?q=%2e"],
  ["/dir/%2e/resource", "/dir/%252e/resource"],
  ["/a\\b", "/a/b"],
  ["/resource?", "/resource"],
  ["/resource?q=%2e", "/resource?q=."],
])("cache read targets keep distinct paths and queries: %s, %s", (a, b) => {
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

test.each(["%2e%2e", "%2E%2E", ".%2e", "%2e."])(
  "encoded parent %s shares invalidation with the plain path, while reads stay separate",
  (segment) => {
    const plain = getRequestCacheKey("http://example.com/resource?q=%2e", {});
    const encoded = getRequestCacheKey(
      `http://example.com/dir/${segment}/resource?q=%2e`,
      {},
    );
    expect(encoded).not.toBe(plain);
    expect(getCacheBucketKey(encoded)).toBe(getCacheBucketKey(plain));
  },
);

test.each([
  ["/resource", "/other"],
  ["/resource?q=%2e", "/resource?q=."],
])("unrelated targets use different invalidation buckets: %s, %s", (a, b) => {
  expect(
    getCacheBucketKey(getRequestCacheKey(`http://example.com${a}`, {})),
  ).not.toBe(
    getCacheBucketKey(getRequestCacheKey(`http://example.com${b}`, {})),
  );
});

test("mixed dots bypass caching and invalidate both normalization results", () => {
  const url = "http://example.com/dir/%2e/../resource";
  expect(canUseRequestCache(url, [], {})).toBe(false);
  const buckets = getRequestCacheInvalidationKeys(url, {}).map(
    getCacheBucketKey,
  );
  expect(buckets).toEqual(
    expect.arrayContaining([
      getCacheBucketKey(getRequestCacheKey("http://example.com/resource", {})),
      getCacheBucketKey(
        getRequestCacheKey("http://example.com/dir/resource", {}),
      ),
    ]),
  );
  expect(
    canUseRequestCache("http://example.com/dir/%2e%2e/resource", [], {}),
  ).toBe(true);
  expect(
    canUseRequestCache(
      "http://example.com/dir/%2e%2e/child/../resource",
      [],
      {},
    ),
  ).toBe(true);
});

test("an empty query shares invalidation without sharing the cached effective URL", () => {
  const plain = getRequestCacheKey("http://example.com/resource", {});
  const empty = getRequestCacheKey("http://example.com/resource?", {});
  expect(plain).not.toBe(empty);
  expect(getCacheBucketKey(plain)).toBe(getCacheBucketKey(empty));
});

test.each([
  "https://cache.test/key",
  "[]",
  '["namespace",3,"target"]',
  '[0,3,"target","read"]',
])("low-level cache key %s is not mistaken for a bucket identity", (key) =>
  expect(getCacheBucketKey(key)).toBe(key),
);

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
