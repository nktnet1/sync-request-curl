import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import {
  canCacheResponse,
  getCachedResponse,
  invalidateCache,
  prepareCacheLookup,
  refreshCacheEntry,
  storeCacheResponse,
  updateCacheFromHead,
} from "#/request/cache";
import { getCacheBucketKey, getRequestCacheKey } from "#/request/cache-key";
import { fileCacheDirectory, getCachePath } from "#/request/cache-path";

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
    storeCacheResponse({
      url: plain,
      requestHeaders: { "x-variant": ["a"] },
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("plain a", headers),
      cache: cache,
    });
    storeCacheResponse({
      url: encoded,
      requestHeaders: { "x-variant": ["a"] },
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("encoded a", headers),
      cache: cache,
    });
    storeCacheResponse({
      url: encoded,
      requestHeaders: { "x-variant": ["b"] },
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("encoded b", headers),
      cache: cache,
    });
    storeCacheResponse({
      url: plain,
      requestHeaders: { "x-variant": ["a"] },
      requestTimestamp: 0,
      responseTimestamp: 1,
      response: response("plain replacement", headers),
      cache: cache,
    });
    for (const [key, variant, body] of [
      [plain, "a", "plain replacement"],
      [encoded, "a", "encoded a"],
      [encoded, "b", "encoded b"],
    ]) {
      const lookup = prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [`X-Variant: ${variant}`],
        cache: cache,
        now: 2,
      });
      expect(lookup.useCachedResponse).toBe(true);
      expect(
        lookup.entry && getCachedResponse(lookup.entry, 2).body.toString(),
      ).toBe(body);
    }
    storeCacheResponse({
      url: plain,
      requestHeaders: { "x-variant": ["a"] },
      requestTimestamp: 0,
      responseTimestamp: 2,
      response: response("plain stale", {
        ...headers,
        "cache-control": "max-age=0",
      }),
      cache: cache,
    });
    const lookup = prepareCacheLookup({
      method: "GET",
      url: plain,
      headers: ["X-Variant: a"],
      cache: cache,
      now: 3,
    });
    expect(
      refreshCacheEntry({
        url: plain,
        lookup: lookup,
        responseHeaders: { etag: '"same"', "cache-control": "max-age=60" },
        responseTimestamp: 4,
        cache: cache,
      })?.body.toString(),
    ).toBe("plain stale");
    const sibling = prepareCacheLookup({
      method: "GET",
      url: encoded,
      headers: ["X-Variant: b"],
      cache: cache,
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
      storeCacheResponse({
        url: key,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
        response: response(key),
        cache: cache,
      });
    invalidateCache(keys[1], cache);
    for (const key of keys)
      expect(
        prepareCacheLookup({
          method: "GET",
          url: key,
          headers: [],
          cache: cache,
          now: 1,
        }).entry,
      ).toBeUndefined();
    for (const key of unrelated)
      expect(
        prepareCacheLookup({
          method: "GET",
          url: key,
          headers: [],
          cache: cache,
          now: 1,
        }).useCachedResponse,
      ).toBe(true);
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
      storeCacheResponse({
        url: key,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
        response: response("good body"),
        cache: cache,
      });
      storeCacheResponse({
        url: key,
        requestHeaders: { "if-match": ['"missing"'] },
        requestTimestamp: 1,
        responseTimestamp: 1,
        response: failed,
        cache: cache,
      });
      const lookup = prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [],
        cache: cache,
        now: 2,
      });
      expect(lookup.entry?.statusCode).toBe(200);
      expect(
        lookup.entry && getCachedResponse(lookup.entry, 2).body.toString(),
      ).toBe("good body");
      const cold = keyFor(target());
      storeCacheResponse({
        url: cold,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
        response: failed,
        cache: cache,
      });
      expect(
        prepareCacheLookup({
          method: "GET",
          url: cold,
          headers: [],
          cache: cache,
          now: 1,
        }).entry,
      ).toBeUndefined();
    },
  );

  test.each([
    { "cache-control": "max-age=0, max-age=3600" },
    { "cache-control": ['max-age="0"', "MAX-AGE=3600"] },
  ])(
    "the first response max-age wins across duplicate directives %j",
    (headers) => {
      const key = keyFor(target());
      storeCacheResponse({
        url: key,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
        response: response("stale", headers),
        cache: cache,
      });
      expect(
        prepareCacheLookup({
          method: "GET",
          url: key,
          headers: [],
          cache: cache,
          now: 1,
        }).useCachedResponse,
      ).toBe(false);
    },
  );

  test("request max-age also uses its first occurrence", () => {
    const key = keyFor(target());
    storeCacheResponse({
      url: key,
      requestHeaders: {},
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("cached"),
      cache: cache,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["Cache-Control: max-age=0", "Cache-Control: max-age=3600"],
        cache: cache,
        now: 1,
      }).useCachedResponse,
    ).toBe(false);
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["Cache-Control: max-age=3600, max-age=0"],
        cache: cache,
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
    storeCacheResponse({
      url: key,
      requestHeaders: {},
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("cached", {
        "cache-control": "max-age=3600",
        etag: '"original"',
        "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
        "content-length": "6",
      }),
      cache: cache,
    });
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: [],
        cache: cache,
        now: 1,
      }),
      responseHeaders: headers,
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [],
        cache: cache,
        now: 3,
      }).entry,
    ).toBeUndefined();
  });

  test("matching HEAD metadata freshens a stale GET while preserving its body", () => {
    const key = keyFor(target());
    storeCacheResponse({
      url: key,
      requestHeaders: {},
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("cached", {
        "cache-control": "max-age=0",
        etag: '"original"',
        "content-length": "6",
      }),
      cache: cache,
    });
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: [],
        cache: cache,
        now: 1_000,
      }),
      responseHeaders: {
        "cache-control": "max-age=60",
        etag: '"original"',
        "content-length": "6",
        "x-head": "updated",
      },
      responseTimestamp: 1_010,
      cache: cache,
      decompress: true,
    });
    const lookup = prepareCacheLookup({
      method: "GET",
      url: key,
      headers: [],
      cache: cache,
      now: 1_020,
    });
    expect(lookup.useCachedResponse).toBe(true);
    expect(lookup.entry?.headers["x-head"]).toBe("updated");
    expect(
      lookup.entry && getCachedResponse(lookup.entry, 1_020).body.toString(),
    ).toBe("cached");
  });

  test("HEAD on an empty cache never creates a bodyless GET entry", () => {
    const key = keyFor(target());
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: [],
        cache: cache,
        now: 1,
      }),
      responseHeaders: {
        "cache-control": "max-age=60",
        etag: '"original"',
        "content-length": "6",
      },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [],
        cache: cache,
        now: 3,
      }).entry,
    ).toBeUndefined();
    expect(existsSync(getCachePath(getCacheBucketKey(key)))).toBe(false);
  });

  test("HEAD request no-store invalidates without refreshing stored metadata", () => {
    const key = keyFor(target());
    storeCacheResponse({
      url: key,
      requestHeaders: {},
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("cached"),
      cache: cache,
    });
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: ["Cache-Control: no-store"],
        cache: cache,
        now: 1,
      }),
      responseHeaders: { "cache-control": "max-age=60" },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [],
        cache: cache,
        now: 3,
      }).entry,
    ).toBeUndefined();
  });

  test("HEAD updates the request headers used by a changed Vary definition", () => {
    const key = keyFor(target());
    storeCacheResponse({
      url: key,
      requestHeaders: { "x-variant": ["old"] },
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("cached", {
        "cache-control": "max-age=0",
        etag: '"same"',
      }),
      cache: cache,
    });
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: ["X-Variant: new"],
        cache: cache,
        now: 1,
      }),
      responseHeaders: {
        etag: '"same"',
        vary: "X-Variant",
        "cache-control": "max-age=60",
      },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["X-Variant: new"],
        cache: cache,
        now: 3,
      }).useCachedResponse,
    ).toBe(true);
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["X-Variant: old"],
        cache: cache,
        now: 3,
      }).useCachedResponse,
    ).toBe(false);
  });

  test("HEAD respects the custom variant matching policy", () => {
    const key = keyFor(target());
    storeCacheResponse({
      url: key,
      requestHeaders: {},
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("cached"),
      cache: cache,
    });
    let calls = 0;
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: [],
        cache: cache,
        now: 1,
      }),
      responseHeaders: { etag: '"changed"' },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
      policy: {
        isMatch: (_headers, cached, defaultValue) => {
          calls += 1;
          expect(defaultValue).toBe(true);
          expect(cached.body.toString()).toBe("cached");
          return false;
        },
      },
    });
    expect(calls).toBe(1);
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [],
        cache: cache,
        now: 3,
      }).useCachedResponse,
    ).toBe(true);
  });

  test("HEAD preserves unmatched Vary and decompression variants", () => {
    const key = keyFor(target());
    const headers = {
      "cache-control": "max-age=60",
      vary: "X-Variant",
      etag: '"original"',
    };
    for (const variant of ["a", "b"])
      storeCacheResponse({
        url: key,
        requestHeaders: { "x-variant": [variant] },
        requestTimestamp: 0,
        responseTimestamp: 0,
        response: response(variant, headers),
        cache: cache,
      });
    storeCacheResponse({
      url: key,
      requestHeaders: { "x-variant": ["a"] },
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: response("undecoded", headers),
      cache: cache,
      options: { decompress: false },
    });
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: ["X-Variant: a"],
        cache: cache,
        now: 1,
      }),
      responseHeaders: { etag: '"changed"' },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["X-Variant: a"],
        cache: cache,
        now: 3,
      }).entry,
    ).toBeUndefined();
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["X-Variant: b"],
        cache: cache,
        now: 3,
      }).useCachedResponse,
    ).toBe(true);
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: ["X-Variant: a"],
        cache: cache,
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
      storeCacheResponse({
        url: key,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
        response: response("body", {
          "cache-control": "max-age=60",
          etag: '"same"',
        }),
        cache: cache,
      });
    updateCacheFromHead({
      url: plain,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: plain,
        headers: [],
        cache: cache,
        now: 1,
      }),
      responseHeaders: { etag: '"same"' },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: plain,
        headers: [],
        cache: cache,
        now: 3,
      }).useCachedResponse,
    ).toBe(true);
    expect(
      prepareCacheLookup({
        method: "GET",
        url: encoded,
        headers: [],
        cache: cache,
        now: 3,
      }).entry,
    ).toBeUndefined();
  });

  test("a successful HEAD cannot freshen a cached redirect body", () => {
    const key = keyFor(target());
    storeCacheResponse({
      url: key,
      requestHeaders: {},
      requestTimestamp: 0,
      responseTimestamp: 0,
      response: {
        ...response("redirect", {
          "cache-control": "max-age=60",
          etag: '"same"',
          location: "https://cache.test/next",
        }),
        statusCode: 301,
      },
      cache: cache,
    });
    updateCacheFromHead({
      url: key,
      lookup: prepareCacheLookup({
        method: "HEAD",
        url: key,
        headers: [],
        cache: cache,
        now: 1,
      }),
      responseHeaders: { etag: '"same"' },
      responseTimestamp: 2,
      cache: cache,
      decompress: true,
    });
    expect(
      prepareCacheLookup({
        method: "GET",
        url: key,
        headers: [],
        cache: cache,
        now: 3,
      }).entry,
    ).toBeUndefined();
  });
});

test("old file buckets without target identities are discarded", () => {
  const key = keyFor(target());
  const path = getCachePath(getCacheBucketKey(key));
  mkdirSync(fileCacheDirectory, { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, entries: [] }));
  expect(
    prepareCacheLookup({
      method: "GET",
      url: key,
      headers: [],
      cache: "file",
      now: 1,
    }).entry,
  ).toBeUndefined();
  expect(existsSync(path)).toBe(false);
});
