import { afterEach, describe, expect, test } from "vitest";
import {
  getCachedResponse,
  invalidateCache,
  prepareCacheLookup,
  refreshCacheEntry,
  storeCacheResponse,
  updateCacheFromHead,
} from "#/request/cache";

type CacheMode = "file" | "memory";
let serial = 0;
const touched = new Map<string, CacheMode>();

const seed = (
  cache: CacheMode,
  headers: Record<string, string | string[] | undefined>,
) => {
  const key = `https://cache-directives.test/${process.pid}-${++serial}`;
  touched.set(key, cache);
  storeCacheResponse(
    key,
    {},
    0,
    0,
    {
      statusCode: 200,
      headers,
      body: Buffer.from("cached"),
      responseUrl: key,
    },
    cache,
  );
  return key;
};

const expectStaleAge = (cache: CacheMode, age: string | string[]) => {
  const key = seed(cache, { "cache-control": "max-age=60", age });
  const lookup = prepareCacheLookup("GET", key, [], cache, 0);
  expect(lookup.useCachedResponse).toBe(false);
  if (!lookup.entry) throw new Error("Missing stored response");
  return getCachedResponse(lookup.entry, 0).headers.age;
};

afterEach(() => {
  for (const [key, cache] of touched) invalidateCache(key, cache);
  touched.clear();
});

describe.each(["file", "memory"] as const)(
  "%s cache directive parsing",
  (cache) => {
    test.each([
      { name: "commas", control: 'x-note="a, max-age=3600, b"' },
      { name: "escaped quote", control: 'x-note="a\\", max-age=3600, b"' },
      {
        name: "unterminated quote",
        control: 'x-note="unterminated, max-age=3600',
      },
      {
        name: "long escaped value",
        control: `x-note="${'\\"'.repeat(4_096)}, max-age=3600, b"`,
      },
    ])(
      "quoted extension values cannot create freshness: $name",
      ({ control }) => {
        const key = seed(cache, { "cache-control": control });
        expect(
          prepareCacheLookup("GET", key, [], cache, 1).useCachedResponse,
        ).toBe(false);
      },
    );

    test.for([
      'x-note="a, no-store, b", max-age=60',
      'x-note="a, max-age=0, b", max-age="60"',
      'x-note="a\\\\", max-age=60',
      ['x-note="a, max-age=0, b"', "max-age=60"],
    ])("real directives outside quotes still apply: %j", (control) => {
      const key = seed(cache, { "cache-control": control });
      expect(
        prepareCacheLookup("GET", key, [], cache, 1).useCachedResponse,
      ).toBe(true);
    });

    test.each(['x-note="a, no-store, b"', 'x-note="a, max-age=0, b"'])(
      "request extensions cannot invent restrictions: %s",
      (control) => {
        const key = seed(cache, { "cache-control": "max-age=60" });
        const lookup = prepareCacheLookup(
          "GET",
          key,
          [`Cache-Control: ${control}`],
          cache,
          1,
        );
        expect(lookup.allowStore).toBe(true);
        expect(lookup.useCachedResponse).toBe(true);
      },
    );

    test("a real first max-age wins despite embedded and duplicate values", () => {
      const key = seed(cache, {
        "cache-control": 'max-age=0, x-note="a, max-age=3600, b", max-age=60',
      });
      expect(
        prepareCacheLookup("GET", key, [], cache, 1).useCachedResponse,
      ).toBe(false);
    });

    test.for(["120, 0", " 120 \t, 0", ["120", "0"]])(
      "the first Age member determines freshness: %j",
      (age) => {
        expect(expectStaleAge(cache, age)).toBe("120");
      },
    );

    test.each(["9007199254740992", "9".repeat(400)])(
      "an overflowing Age cannot become fresh: %s",
      (age) => {
        const reportedAge = Number(expectStaleAge(cache, age));
        expect(Number.isFinite(reportedAge)).toBe(true);
        expect(reportedAge).toBeGreaterThan(2_147_483_648);
      },
    );

    test.each(["", "-1", "unknown, 120", "0x78"])(
      "an invalid first Age member is ignored: %s",
      (age) => {
        const key = seed(cache, { "cache-control": "max-age=60", age });
        expect(
          prepareCacheLookup("GET", key, [], cache, 0).useCachedResponse,
        ).toBe(true);
      },
    );

    test.each([
      { receivedAge: undefined, expectedAge: "0", fresh: true },
      { receivedAge: "10", expectedAge: "10", fresh: true },
      { receivedAge: "120", expectedAge: "120", fresh: false },
    ])(
      "304 age comes from the new response: $expectedAge",
      ({ receivedAge, expectedAge, fresh }) => {
        const key = seed(cache, {
          "cache-control": "max-age=60",
          etag: '"same"',
          age: "120",
        });
        const lookup = prepareCacheLookup("GET", key, [], cache, 0);
        refreshCacheEntry(
          key,
          lookup,
          { etag: '"same"', age: receivedAge },
          0,
          cache,
        );
        const refreshed = prepareCacheLookup("GET", key, [], cache, 0);
        expect(refreshed.useCachedResponse).toBe(fresh);
        if (!refreshed.entry) throw new Error("Missing refreshed response");
        expect(getCachedResponse(refreshed.entry, 0).headers.age).toBe(
          expectedAge,
        );
      },
    );

    test("HEAD metadata also replaces the old response's age", () => {
      const key = seed(cache, {
        "cache-control": "max-age=60",
        etag: '"same"',
        age: "120",
      });
      updateCacheFromHead(
        key,
        prepareCacheLookup("HEAD", key, [], cache, 0),
        { etag: '"same"' },
        0,
        cache,
        true,
      );
      expect(
        prepareCacheLookup("GET", key, [], cache, 0).useCachedResponse,
      ).toBe(true);
    });

    test("request no-store prevents refresh even when a lookup carries an entry", () => {
      const key = seed(cache, { "cache-control": "max-age=0", etag: '"same"' });
      const original = prepareCacheLookup("GET", key, [], cache, 0);
      const bypassed = prepareCacheLookup(
        "GET",
        key,
        ["Cache-Control: no-store"],
        cache,
        0,
      );
      expect(
        refreshCacheEntry(
          key,
          { ...bypassed, entry: original.entry },
          { "cache-control": "max-age=60" },
          0,
          cache,
        ),
      ).toBeUndefined();
      expect(
        prepareCacheLookup("GET", key, [], cache, 0).useCachedResponse,
      ).toBe(false);
    });
  },
);
