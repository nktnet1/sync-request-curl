import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  getCachedResponse,
  prepareCacheLookup,
  refreshCacheEntry,
  storeCacheResponse,
  updateCacheFromHead,
} from "#/request/cache";
import { createCacheTracker } from "#tests/request/cache/cleanup";

const trackCache = createCacheTracker();
const original = Buffer.from("original representation");
let serial = 0;
const nextKey = () =>
  `https://cache-representation.test/${process.pid}-${++serial}`;

describe.each(["file", "memory"] as const)(
  "%s cache representation integrity",
  (cache) => {
    test.each([
      { "cache-control": "max-age=60" },
      { expires: new Date(Date.now() + 60_000).toUTCString() },
    ])("delta responses cannot satisfy ordinary GETs: %j", (freshness) => {
      const key = nextKey();
      trackCache(key, cache);
      const now = Date.now();
      storeCacheResponse(
        key,
        { "a-im": ["diffe"], "if-none-match": ['"base"'] },
        now,
        now,
        {
          statusCode: 226,
          headers: {
            ...freshness,
            im: "diffe",
            "delta-base": '"base"',
            etag: '"updated"',
          },
          body: Buffer.from("delta instructions"),
          responseUrl: key,
        },
        cache,
      );
      expect(prepareCacheLookup("GET", key, [], cache).entry).toBeUndefined();
    });

    test("cache policy callbacks receive independent request header copies", () => {
      const key = nextKey();
      trackCache(key, cache);
      const requestHeaders = {
        "x-single": ["value"],
        "x-multi": ["one", "two"],
      };
      storeCacheResponse(
        key,
        requestHeaders,
        0,
        0,
        {
          statusCode: 200,
          headers: { "cache-control": "max-age=60", vary: "X-Multi" },
          body: original,
          responseUrl: key,
        },
        cache,
      );
      const headers = ["X-Single: value", "X-Multi: one", "X-Multi: two"];
      const lookup = prepareCacheLookup("GET", key, headers, cache, 1, true, {
        isMatch: (outgoing, cached, defaultValue) => {
          expect(defaultValue).toBe(true);
          expect(cached.requestHeaders).toEqual({
            "x-single": "value",
            "x-multi": ["one", "two"],
          });
          const outgoingValues = outgoing["x-multi"];
          const cachedValues = cached.requestHeaders["x-multi"];
          if (!Array.isArray(outgoingValues) || !Array.isArray(cachedValues))
            throw new Error("Missing repeated headers");
          outgoingValues.push("changed");
          cachedValues.push("changed");
          cached.requestHeaders["x-single"] = "changed";
          return defaultValue;
        },
        isExpired: (cached, defaultValue) => {
          expect(defaultValue).toBe(false);
          expect(cached.requestHeaders["x-single"]).toBe("value");
          expect(cached.requestHeaders["x-multi"]).toEqual(["one", "two"]);
          return defaultValue;
        },
      });
      expect(lookup.useCachedResponse).toBe(true);
      expect(lookup.entry?.requestHeaders).toEqual(requestHeaders);
      expect(
        prepareCacheLookup("GET", key, headers, cache, 2).useCachedResponse,
      ).toBe(true);
    });

    describe.each(["304", "HEAD"] as const)("%s metadata", (method) => {
      test.each([
        {
          name: "encoded gzip",
          encoding: "gzip",
          body: gzipSync(original),
          decompress: false,
        },
        {
          name: "opaque Brotli",
          encoding: "br",
          body: brotliCompressSync(original),
          decompress: true,
        },
        {
          name: "decoded bytes",
          encoding: undefined,
          body: original,
          decompress: true,
        },
      ])("preserves the coding of $name", ({ encoding, body, decompress }) => {
        const key = nextKey();
        trackCache(key, cache);
        storeCacheResponse(
          key,
          {},
          0,
          0,
          {
            statusCode: 200,
            headers: {
              "cache-control": "max-age=0",
              etag: 'W/"same"',
              ...(encoding === undefined
                ? {}
                : { "content-encoding": encoding }),
            },
            body,
            responseUrl: key,
          },
          cache,
          { decompress },
        );
        const lookup = prepareCacheLookup(
          method === "304" ? "GET" : "HEAD",
          key,
          [],
          cache,
          1,
          decompress,
        );
        const headers = {
          "cache-control": "max-age=60",
          etag: 'W/"same"',
          "content-encoding": "deflate",
          "x-validated": "yes",
        };
        if (method === "304") {
          const response = refreshCacheEntry(key, lookup, headers, 2, cache);
          expect(response?.body).toEqual(body);
          expect(response?.headers["content-encoding"]).toBe(encoding);
        } else {
          updateCacheFromHead(key, lookup, headers, 2, cache, decompress);
        }
        const refreshed = prepareCacheLookup(
          "GET",
          key,
          [],
          cache,
          3,
          decompress,
        );
        expect(refreshed.useCachedResponse).toBe(true);
        expect(refreshed.entry).toBeDefined();
        if (!refreshed.entry) throw new Error("Missing refreshed entry");
        const response = getCachedResponse(refreshed.entry, 3);
        expect(response.body).toEqual(body);
        expect(response.headers["content-encoding"]).toBe(encoding);
        expect(response.headers["x-validated"]).toBe("yes");
      });
    });
  },
);
