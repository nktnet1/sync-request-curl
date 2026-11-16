import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import {
  canCacheResponse,
  getCachedResponse,
  invalidateCache,
  refreshCacheEntry,
} from "#/request/cache";
import { getCacheBucketKey, getRequestCacheKey } from "#/request/cache/key";
import { fileCacheDirectory, getCachePath } from "#/request/cache/path";
import {
  lookupCache,
  storeCacheFixture,
  updateHeadFixture,
} from "#tests/request/cache/fixtures";

let nextTarget = 0;
const touchedPaths = new Set<string>();
const target = () =>
  `https://cache.test/regressions/${process.pid}-${++nextTarget}`;
const keyFor = (url: string, cacheNamespace = "cache-regressions"): string => {
  const key = getRequestCacheKey(url, { cacheNamespace });
  touchedPaths.add(getCachePath(getCacheBucketKey(key)));
  return key;
};
const response = (
  body: string,
  headers: Record<string, string | string[] | undefined> = {
    "cache-control": "max-age=3600",
  },
) => ({
  statusCode: 200,
  headers,
  body: Buffer.from(body),
  responseUrl: "https://cache.test/resource",
});

afterEach(() => {
  for (const path of touchedPaths) rmSync(path, { force: true });
  touchedPaths.clear();
});

describe.each(["file", "memory"] as const)("%s cache regressions", (cache) => {
  test("read targets and Vary variants stay isolated inside one invalidation bucket", () => {
    const url = target();
    const plain = keyFor(url);
    const encoded = keyFor(
      url.replace("/regressions/", "/regressions/dir/%2e%2e/"),
    );
    const headers = {
      "cache-control": "max-age=3600",
      vary: "X-Variant",
      etag: '"same"',
    };
    storeCacheFixture(plain, cache, response("plain a", headers), {
      requestHeaders: { "x-variant": ["a"] },
    });
    storeCacheFixture(encoded, cache, response("encoded a", headers), {
      requestHeaders: { "x-variant": ["a"] },
    });
    storeCacheFixture(encoded, cache, response("encoded b", headers), {
      requestHeaders: { "x-variant": ["b"] },
    });
    storeCacheFixture(plain, cache, response("plain replacement", headers), {
      requestHeaders: { "x-variant": ["a"] },
      responseTimestamp: 1,
    });
    for (const [key, variant, body] of [
      [plain, "a", "plain replacement"],
      [encoded, "a", "encoded a"],
      [encoded, "b", "encoded b"],
    ]) {
      const lookup = lookupCache(key, cache, {
        headers: [`X-Variant: ${variant}`],
        now: 2,
      });
      expect(lookup.useCachedResponse).toBe(true);
      expect(
        lookup.entry && getCachedResponse(lookup.entry, 2).body.toString(),
      ).toBe(body);
    }
    storeCacheFixture(
      plain,
      cache,
      response("plain stale", {
        ...headers,
        "cache-control": "max-age=0",
      }),
      { requestHeaders: { "x-variant": ["a"] }, responseTimestamp: 2 },
    );
    const lookup = lookupCache(plain, cache, {
      headers: ["X-Variant: a"],
      now: 3,
    });
    expect(
      refreshCacheEntry({
        url: plain,
        lookup,
        responseHeaders: { etag: '"same"', "cache-control": "max-age=60" },
        responseTimestamp: 4,
        cache,
      })?.body.toString(),
    ).toBe("plain stale");
    const sibling = lookupCache(encoded, cache, {
      headers: ["X-Variant: b"],
      now: 5,
    });
    expect(
      sibling.entry && getCachedResponse(sibling.entry, 5).body.toString(),
    ).toBe("encoded b");
  });

  test("invalidating an encoded alias removes its whole bucket and preserves other identities", () => {
    const url = target();
    const keys = [
      url,
      `${url}?`,
      url.replace("/regressions/", "/regressions/dir/%2e%2e/"),
      url.replace("/regressions/", "/regressions/dir/.%2E/"),
    ].map((value) => keyFor(value));
    const unrelated = [
      keyFor(`${url}?q=other`),
      keyFor(url, "other-namespace"),
      keyFor(url.replace("cache.test", "other.test")),
    ];
    for (const key of [...keys, ...unrelated])
      storeCacheFixture(key, cache, response(key));
    invalidateCache(keys[1], cache);
    for (const key of keys)
      expect(lookupCache(key, cache, { now: 1 }).entry).toBeUndefined();
    for (const key of unrelated)
      expect(lookupCache(key, cache, { now: 1 }).useCachedResponse).toBe(true);
  });

  test.each([
    { "cache-control": "max-age=3600" },
    { expires: "Wed, 21 Oct 2037 07:29:00 GMT" },
  ])(
    "a 412 with explicit freshness %j neither replaces nor creates a reusable GET",
    (headers) => {
      const key = keyFor(target());
      const failed = {
        ...response("precondition failed", headers),
        statusCode: 412,
      };
      expect(canCacheResponse(failed)).toBe(false);
      storeCacheFixture(key, cache, response("good body"));
      storeCacheFixture(key, cache, failed, {
        requestHeaders: { "if-match": ['"missing"'] },
        requestTimestamp: 1,
        responseTimestamp: 1,
      });
      const lookup = lookupCache(key, cache, { now: 2 });
      expect(lookup.entry?.statusCode).toBe(200);
      expect(
        lookup.entry && getCachedResponse(lookup.entry, 2).body.toString(),
      ).toBe("good body");
      const cold = keyFor(target());
      storeCacheFixture(cold, cache, failed);
      expect(lookupCache(cold, cache, { now: 1 }).entry).toBeUndefined();
    },
  );

  test.each([
    { "cache-control": "max-age=0, max-age=3600" },
    { "cache-control": ['max-age="0"', "MAX-AGE=3600"] },
  ])(
    "the first response max-age wins across duplicate directives %j",
    (headers) => {
      const key = keyFor(target());
      storeCacheFixture(key, cache, response("stale", headers));
      expect(lookupCache(key, cache, { now: 1 }).useCachedResponse).toBe(false);
    },
  );

  test("request max-age also uses its first occurrence", () => {
    const key = keyFor(target());
    storeCacheFixture(key, cache, response("cached"));
    expect(
      lookupCache(key, cache, {
        headers: ["Cache-Control: max-age=0", "Cache-Control: max-age=3600"],
        now: 1,
      }).useCachedResponse,
    ).toBe(false);
    expect(
      lookupCache(key, cache, {
        headers: ["Cache-Control: max-age=3600, max-age=0"],
        now: 1,
      }).useCachedResponse,
    ).toBe(true);
  });

  test.each([
    { etag: '"changed"' },
    { "last-modified": "Thu, 22 Oct 2015 07:28:00 GMT" },
    { "content-length": "7" },
    { "cache-control": "no-store" },
    { vary: "*" },
    { "set-cookie": ["session=secret"] },
  ])("HEAD metadata %j invalidates the matching GET", (headers) => {
    const key = keyFor(target());
    storeCacheFixture(
      key,
      cache,
      response("cached", {
        "cache-control": "max-age=3600",
        etag: '"original"',
        "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
        "content-length": "6",
      }),
    );
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, { method: "HEAD", now: 1 }),
      headers,
      2,
    );
    expect(lookupCache(key, cache, { now: 3 }).entry).toBeUndefined();
  });

  test("matching HEAD metadata freshens a stale GET while preserving its body", () => {
    const key = keyFor(target());
    storeCacheFixture(
      key,
      cache,
      response("cached", {
        "cache-control": "max-age=0",
        etag: '"original"',
        "content-length": "6",
      }),
    );
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, { method: "HEAD", now: 1_000 }),
      {
        "cache-control": "max-age=60",
        etag: '"original"',
        "content-length": "6",
        "x-head": "updated",
      },
      1_010,
    );
    const lookup = lookupCache(key, cache, { now: 1_020 });
    expect(lookup.useCachedResponse).toBe(true);
    expect(lookup.entry?.headers["x-head"]).toBe("updated");
    expect(
      lookup.entry && getCachedResponse(lookup.entry, 1_020).body.toString(),
    ).toBe("cached");
  });

  test("HEAD on an empty cache never creates a bodyless GET entry", () => {
    const key = keyFor(target());
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, { method: "HEAD", now: 1 }),
      {
        "cache-control": "max-age=60",
        etag: '"original"',
        "content-length": "6",
      },
      2,
    );
    expect(lookupCache(key, cache, { now: 3 }).entry).toBeUndefined();
    expect(existsSync(getCachePath(getCacheBucketKey(key)))).toBe(false);
  });

  test("HEAD request no-store invalidates without refreshing stored metadata", () => {
    const key = keyFor(target());
    storeCacheFixture(key, cache, response("cached"));
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, {
        method: "HEAD",
        headers: ["Cache-Control: no-store"],
        now: 1,
      }),
      { "cache-control": "max-age=60" },
      2,
    );
    expect(lookupCache(key, cache, { now: 3 }).entry).toBeUndefined();
  });

  test("HEAD updates the request headers used by a changed Vary definition", () => {
    const key = keyFor(target());
    storeCacheFixture(
      key,
      cache,
      response("cached", {
        "cache-control": "max-age=0",
        etag: '"same"',
      }),
      { requestHeaders: { "x-variant": ["old"] } },
    );
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, {
        method: "HEAD",
        headers: ["X-Variant: new"],
        now: 1,
      }),
      {
        etag: '"same"',
        vary: "X-Variant",
        "cache-control": "max-age=60",
      },
      2,
    );
    expect(
      lookupCache(key, cache, { headers: ["X-Variant: new"], now: 3 })
        .useCachedResponse,
    ).toBe(true);
    expect(
      lookupCache(key, cache, { headers: ["X-Variant: old"], now: 3 })
        .useCachedResponse,
    ).toBe(false);
  });

  test("HEAD respects the custom variant matching policy", () => {
    const key = keyFor(target());
    storeCacheFixture(key, cache, response("cached"));
    let calls = 0;
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, { method: "HEAD", now: 1 }),
      { etag: '"changed"' },
      2,
      {
        policy: {
          isMatch: (_headers, cached, defaultValue) => {
            calls += 1;
            expect(defaultValue).toBe(true);
            expect(cached.body.toString()).toBe("cached");
            return false;
          },
        },
      },
    );
    expect(calls).toBe(1);
    expect(lookupCache(key, cache, { now: 3 }).useCachedResponse).toBe(true);
  });

  test("HEAD preserves unmatched Vary and decompression variants", () => {
    const key = keyFor(target());
    const headers = {
      "cache-control": "max-age=60",
      vary: "X-Variant",
      etag: '"original"',
    };
    for (const variant of ["a", "b"])
      storeCacheFixture(key, cache, response(variant, headers), {
        requestHeaders: { "x-variant": [variant] },
      });
    storeCacheFixture(key, cache, response("undecoded", headers), {
      requestHeaders: { "x-variant": ["a"] },
      options: { decompress: false },
    });
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, {
        method: "HEAD",
        headers: ["X-Variant: a"],
        now: 1,
      }),
      { etag: '"changed"' },
      2,
    );
    expect(
      lookupCache(key, cache, { headers: ["X-Variant: a"], now: 3 }).entry,
    ).toBeUndefined();
    expect(
      lookupCache(key, cache, { headers: ["X-Variant: b"], now: 3 })
        .useCachedResponse,
    ).toBe(true);
    expect(
      lookupCache(key, cache, {
        headers: ["X-Variant: a"],
        now: 3,
        decompress: false,
      }).useCachedResponse,
    ).toBe(true);
  });

  test("HEAD invalidates other spellings instead of assigning them unrelated metadata", () => {
    const url = target();
    const plain = keyFor(url);
    const encoded = keyFor(
      url.replace("/regressions/", "/regressions/dir/%2e%2e/"),
    );
    for (const key of [plain, encoded])
      storeCacheFixture(
        key,
        cache,
        response("body", {
          "cache-control": "max-age=60",
          etag: '"same"',
        }),
      );
    updateHeadFixture(
      plain,
      cache,
      lookupCache(plain, cache, { method: "HEAD", now: 1 }),
      { etag: '"same"' },
      2,
    );
    expect(lookupCache(plain, cache, { now: 3 }).useCachedResponse).toBe(true);
    expect(lookupCache(encoded, cache, { now: 3 }).entry).toBeUndefined();
  });

  test("a successful HEAD cannot freshen a cached redirect body", () => {
    const key = keyFor(target());
    storeCacheFixture(key, cache, {
      ...response("redirect", {
        "cache-control": "max-age=60",
        etag: '"same"',
        location: "https://cache.test/next",
      }),
      statusCode: 301,
    });
    updateHeadFixture(
      key,
      cache,
      lookupCache(key, cache, { method: "HEAD", now: 1 }),
      { etag: '"same"' },
      2,
    );
    expect(lookupCache(key, cache, { now: 3 }).entry).toBeUndefined();
  });
});

test("old file buckets without target identities are discarded", () => {
  const key = keyFor(target());
  const path = getCachePath(getCacheBucketKey(key));
  mkdirSync(fileCacheDirectory, { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, entries: [] }));
  expect(lookupCache(key, "file", { now: 1 }).entry).toBeUndefined();
  expect(existsSync(path)).toBe(false);
});
