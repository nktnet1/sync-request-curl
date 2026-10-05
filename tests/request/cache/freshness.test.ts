import { describe, expect, test } from "vitest";
import { prepareCacheLookup, storeCacheResponse } from "#/request/cache";
import { createCacheTracker } from "#tests/request/cache/cleanup";

const now = Date.UTC(2026, 9, 5);
const expires = "Mon, 05 Oct 2026 01:00:00 GMT";
type CacheMode = "file" | "memory";
const trackCache = createCacheTracker();
let serial = 0;

const isFresh = (
  cache: CacheMode,
  headers: Record<string, string>,
  statusCode = 200,
) => {
  const key = `https://cache-freshness.test/${process.pid}-${++serial}`;
  trackCache(key, cache);
  storeCacheResponse(
    key,
    {},
    now,
    now,
    {
      statusCode,
      headers,
      body: Buffer.alloc(0),
      responseUrl: key,
    },
    cache,
  );
  return prepareCacheLookup("GET", key, [], cache, now + 1_000)
    .useCachedResponse;
};

describe.each(["file", "memory"] as const)(
  "%s cache invalid freshness",
  (cache) => {
    test.each([
      "max-age=invalid",
      "max-age",
      "max-age=-1",
      "max-age=1.5",
      "max-age=+60",
      'max-age=""',
      "max-age=invalid, max-age=3600",
      "max-age=9007199254740992",
    ])("invalid max-age cannot fall back to future Expires: %s", (control) => {
      expect(isFresh(cache, { "cache-control": control, expires })).toBe(false);
    });

    test.each([301, 308])(
      "invalid max-age cannot enable heuristic freshness for %i",
      (status) => {
        expect(
          isFresh(
            cache,
            { "cache-control": "max-age=invalid", location: "/next" },
            status,
          ),
        ).toBe(false);
        expect(isFresh(cache, { location: "/next" }, status)).toBe(true);
      },
    );

    test.each([
      "9999",
      "3600",
      "0",
      "2037-10-21T07:29:00Z",
      "Wed, 31 Feb 2037 07:29:00 GMT",
      "Wed, 21 Oct 2037 24:00:00 GMT",
    ])(
      "invalid Expires is stale and cannot override valid max-age: %s",
      (value) => {
        expect(isFresh(cache, { expires: value })).toBe(false);
        expect(
          isFresh(cache, { expires: value, "cache-control": "max-age=60" }),
        ).toBe(true);
      },
    );

    test.each([
      "Mon, 05 Oct 2026 01:00:00 GMT",
      "Monday, 05-Oct-26 01:00:00 GMT",
      "Mon Oct  5 01:00:00 2026",
      "mon, 05 oct 2026 01:00:00 gmt",
    ])(
      "valid Expires still supplies freshness without max-age: %s",
      (value) => {
        expect(isFresh(cache, { expires: value })).toBe(true);
        expect(
          isFresh(cache, { expires: value, "cache-control": "max-age=0" }),
        ).toBe(false);
      },
    );

    test.each([
      "9999",
      "2037-10-21T07:29:00Z",
      "Wed, 31 Feb 2037 07:29:00 GMT",
    ])("invalid Date falls back to receipt time: %s", (date) => {
      expect(isFresh(cache, { date, expires })).toBe(true);
    });
  },
);
