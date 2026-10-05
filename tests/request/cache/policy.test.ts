import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import {
  getCachedRedirectUrl,
  getCachedResponse,
  prepareCacheLookup,
  refreshFileCacheEntry,
  storeCacheResponse,
  storeFileCacheResponse,
} from "#/request/cache";
import { fileCacheDirectory, getCachePath } from "#/request/cache-path";

let nextUrl = 0;
const touchedPaths = new Set<string>();

const cacheUrl = (): string => {
  nextUrl += 1;
  const url = `https://cache.test/${process.pid}-${nextUrl}`;
  touchedPaths.add(getCachePath(url));
  return url;
};

const response = (
  url: string,
  headers: Record<string, string | string[]> = {},
) => ({
  statusCode: 200,
  headers,
  body: Buffer.from("cached"),
  responseUrl: url,
});

const storeFreshResponse = (url: string): void => {
  storeFileCacheResponse(
    url,
    {},
    0,
    0,
    response(url, { "cache-control": "max-age=3600" }),
  );
};

const prepareStaleResponse = (headers: Record<string, string | string[]>) => {
  const url = cacheUrl();
  storeFileCacheResponse(url, {}, 0, 0, response(url, headers));
  return {
    url,
    lookup: prepareCacheLookup("GET", url, [], "file", 1),
  };
};

const preparePermanentRedirectLookup = (
  statusCode: number,
  requestHeaders: string[] = [],
  responseHeaders: Record<string, string | string[]> = {},
  now = 1,
) => {
  const url = cacheUrl();
  storeFileCacheResponse(url, {}, 0, 0, {
    statusCode,
    headers: {
      ...responseHeaders,
      location: "https://cache.test/destination",
    },
    body: Buffer.alloc(0),
    responseUrl: url,
  });
  return prepareCacheLookup("GET", url, requestHeaders, "file", now);
};

const writeBucket = (
  url: string,
  entries: Array<Record<string, unknown>>,
): void => {
  mkdirSync(fileCacheDirectory, { recursive: true });
  writeFileSync(
    getCachePath(url),
    JSON.stringify({
      version: 2,
      entries: entries.map((entry) => ({ cacheKey: url, ...entry })),
    }),
    "utf8",
  );
};

afterEach(() => {
  for (const path of touchedPaths) {
    rmSync(path, { force: true });
  }
  touchedPaths.clear();
});

describe("file cache policy", () => {
  test.each(["file", "memory"] as const)(
    "%s cache calculates Age without exposing mutable stored headers",
    (cache) => {
      const url = cacheUrl();
      const original = response(url, {
        "cache-control": "max-age=60",
        age: "10",
        "x-array": ["session=original"],
      });
      storeCacheResponse(url, {}, 0, 2_000, original, cache);
      original.headers["cache-control"] = "no-store";
      original.headers["x-array"] = ["session=changed"];

      const lookup = prepareCacheLookup("GET", url, [], cache, 5_000);
      expect(lookup.useCachedResponse).toBe(true);
      if (!lookup.entry) throw new Error("Missing cache entry");
      const first = getCachedResponse(lookup.entry, 5_000);
      expect(first.headers.age).toBe("15");
      expect(first.headers["x-array"]).toEqual(["session=original"]);
      first.headers["cache-control"] = "no-store";
      const cookies = first.headers["x-array"];
      if (!Array.isArray(cookies)) throw new Error("Missing cookie array");
      cookies.push("session=mutated");
      first.body.fill(0);

      const second = getCachedResponse(lookup.entry, 6_000);
      expect(second.headers).toMatchObject({
        age: "16",
        "cache-control": "max-age=60",
        "x-array": ["session=original"],
      });
      expect(second.body.toString()).toBe("cached");
      expect(lookup.entry.headers.age).toBe("10");
    },
  );

  test("ignores malformed request headers and accumulates duplicate values", () => {
    const lookup = prepareCacheLookup(
      "GET",
      cacheUrl(),
      [
        "malformed",
        "X-Feature;",
        "X-Feature: enabled",
        "X-Early-Semicolon; ignored: yes",
        "Cache-Control: max-age=3600",
        "Cache-Control: no-store",
      ],
      "file",
      0,
    );

    expect(lookup.requestHeaders).toStrictEqual({
      "cache-control": ["max-age=3600", "no-store"],
      "x-early-semicolon": [""],
      "x-feature": ["", "enabled"],
    });
    expect(lookup.allowStore).toBe(false);
  });

  test("supports array-valued response headers", () => {
    const url = cacheUrl();
    storeFileCacheResponse(
      url,
      { "x-a": ["a"], "x-b": ["b"] },
      0,
      0,
      response(url, {
        "cache-control": "max-age=3600",
        vary: ["X-A", "X-B"],
      }),
    );

    expect(
      prepareCacheLookup("GET", url, ["X-A: a", "X-B: b"], "file", 1)
        .useCachedResponse,
    ).toBe(true);
    expect(
      prepareCacheLookup(
        "GET",
        url,
        ["X-A: a", "X-A: extra", "X-B: b"],
        "file",
        1,
      ).useCachedResponse,
    ).toBe(false);
  });

  test("parses quoted Cache-Control directive values", () => {
    const url = cacheUrl();
    storeFileCacheResponse(
      url,
      {},
      0,
      0,
      response(url, { "cache-control": 'max-age="60"' }),
    );

    expect(
      prepareCacheLookup("GET", url, [], "file", 1).useCachedResponse,
    ).toBe(true);
  });

  test("rejects delta-seconds outside the safe integer range", () => {
    const url = cacheUrl();
    storeFileCacheResponse(
      url,
      {},
      0,
      0,
      response(url, {
        "cache-control": "max-age=999999999999999999999",
      }),
    );

    expect(
      prepareCacheLookup("GET", url, [], "file", 1).useCachedResponse,
    ).toBe(false);
  });

  test("matches and replaces Vary entries when the varied header is absent", () => {
    const url = cacheUrl();
    const variedResponse = response(url, {
      "cache-control": "max-age=3600",
      vary: "X-Missing",
    });

    storeFileCacheResponse(url, {}, 0, 0, variedResponse);
    storeFileCacheResponse(url, {}, 1, 1, variedResponse);

    const lookup = prepareCacheLookup("GET", url, [], "file", 2);
    const bucket = JSON.parse(readFileSync(getCachePath(url), "utf8")) as {
      entries: unknown[];
    };

    expect(lookup.useCachedResponse).toBe(true);
    expect(bucket.entries).toHaveLength(1);
  });

  test("uses the response Date as the Expires freshness base", () => {
    const url = cacheUrl();
    const responseDate = "Wed, 21 Oct 2015 07:28:00 GMT";
    const storedAt = Date.parse(responseDate) + 15_000;
    storeFileCacheResponse(
      url,
      {},
      storedAt,
      storedAt,
      response(url, {
        date: responseDate,
        expires: "Wed, 21 Oct 2015 07:29:00 GMT",
      }),
    );

    expect(
      prepareCacheLookup(
        "GET",
        url,
        [],
        "file",
        Date.parse(responseDate) + 59_000,
      ).useCachedResponse,
    ).toBe(true);
  });

  test("stores non-default cacheable statuses with explicit Expires freshness", () => {
    const url = cacheUrl();
    storeFileCacheResponse(url, {}, 0, 0, {
      statusCode: 302,
      headers: { expires: "Wed, 21 Oct 2037 07:29:00 GMT" },
      body: Buffer.alloc(0),
      responseUrl: url,
    });

    expect(existsSync(getCachePath(url))).toBe(true);
  });

  test.each([301, 308])(
    "reuses a bare %i permanent redirect without explicit freshness",
    (statusCode) => {
      expect(
        preparePermanentRedirectLookup(statusCode, [], {}, 86_400_000)
          .useCachedResponse,
      ).toBe(true);
    },
  );

  test.each([301, 308])(
    "honours explicit freshness for %i permanent redirects",
    (statusCode) => {
      expect(
        preparePermanentRedirectLookup(statusCode, [], {
          "cache-control": "max-age=0",
        }).useCachedResponse,
      ).toBe(false);
    },
  );

  test.each([301, 308])(
    "allows request max-age=0 to bypass a cached bare %i permanent redirect",
    (statusCode) => {
      expect(
        preparePermanentRedirectLookup(statusCode, ["Cache-Control: max-age=0"])
          .useCachedResponse,
      ).toBe(false);
    },
  );

  test("returns null for cached redirects without a Location header", () => {
    expect(getCachedRedirectUrl({ statusCode: 302, headers: {} })).toBeNull();
  });

  test("honours request cache directives including empty segments and max-age", () => {
    const url = cacheUrl();
    storeFreshResponse(url);

    const lookup = prepareCacheLookup(
      "GET",
      url,
      ["Cache-Control: max-age=0, , max-age=3600"],
      "file",
      1,
    );

    expect(lookup.entry).toBeDefined();
    expect(lookup.useCachedResponse).toBe(false);
    expect(lookup.isRevalidation).toBe(false);
  });

  test("treats Pragma: no-cache as a request revalidation directive", () => {
    const url = cacheUrl();
    storeFreshResponse(url);

    const lookup = prepareCacheLookup(
      "GET",
      url,
      ["Pragma: no-cache"],
      "file",
      1,
    );

    expect(lookup.entry).toBeDefined();
    expect(lookup.useCachedResponse).toBe(false);
    expect(lookup.revalidationHeaders).toStrictEqual(["Pragma: no-cache"]);
  });

  test.each(["file", "memory"] as const)(
    "%s cache forwards caller preconditions without adding validators",
    (cache) => {
      for (const maxAge of [0, 3600]) {
        const url = cacheUrl();
        storeCacheResponse(
          url,
          {},
          0,
          0,
          response(url, {
            "cache-control": `max-age=${maxAge}`,
            etag: '"v1"',
            "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
          }),
          cache,
        );
        for (const header of [
          'If-Match: "different"',
          "iF-uNmOdIfIeD-sInCe: Tue, 20 Oct 2015 07:28:00 GMT",
        ]) {
          const headers = [header];
          const lookup = prepareCacheLookup("GET", url, headers, cache, 1);
          expect(lookup.entry).toBeDefined();
          expect(lookup.useCachedResponse).toBe(false);
          expect(lookup.isRevalidation).toBe(false);
          expect(lookup.revalidationHeaders).toStrictEqual(headers);
        }
      }
    },
  );

  test("does not reuse a response marked Cache-Control: no-cache", () => {
    const { lookup } = prepareStaleResponse({ "cache-control": "no-cache" });

    expect(lookup.entry).toBeDefined();
    expect(lookup.useCachedResponse).toBe(false);
  });

  test("keeps processed cached metadata consistent during 304 revalidation", () => {
    const { url, lookup } = prepareStaleResponse({
      "cache-control": "max-age=0",
      "content-type": "application/json",
      etag: '"v1"',
    });
    const refreshed = refreshFileCacheEntry(
      url,
      lookup,
      {
        "cache-control": "max-age=60",
        "content-encoding": "gzip",
        "content-length": "123",
        "x-revalidated": "yes",
      },
      2,
    );

    expect(refreshed?.headers).toStrictEqual({
      "cache-control": "max-age=60",
      "content-type": "application/json",
      etag: '"v1"',
      "x-revalidated": "yes",
    });
    expect(refreshed?.body.toString()).toBe("cached");
  });

  test("allows Content-Encoding revalidation when the cached body is still encoded", () => {
    const { url, lookup } = prepareStaleResponse({
      "cache-control": "max-age=0",
      "content-encoding": "br",
      etag: '"v1"',
    });
    const refreshed = refreshFileCacheEntry(
      url,
      lookup,
      {
        "content-encoding": "br",
        "content-length": "999",
      },
      2,
    );

    expect(refreshed?.headers["content-encoding"]).toBe("br");
    expect(refreshed?.headers["content-length"]).toBeUndefined();
  });

  test("refreshes a stale entry through the file-cache compatibility wrapper", () => {
    const { url, lookup } = prepareStaleResponse({
      "cache-control": "max-age=0",
      etag: '"v1"',
    });
    const refreshed = refreshFileCacheEntry(
      url,
      lookup,
      { "cache-control": "max-age=60" },
      2,
    );

    expect(lookup.isRevalidation).toBe(true);
    expect(refreshed?.headers).toStrictEqual({
      "cache-control": "max-age=60",
      etag: '"v1"',
    });
    expect(
      prepareCacheLookup("GET", url, [], "file", 3).useCachedResponse,
    ).toBe(true);
  });

  test("uses Expires freshness when Cache-Control max-age is absent", () => {
    const url = cacheUrl();
    const storedAt = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    storeFileCacheResponse(
      url,
      {},
      storedAt,
      storedAt,
      response(url, { expires: "Wed, 21 Oct 2015 07:29:00 GMT" }),
    );

    const lookup = prepareCacheLookup(
      "GET",
      url,
      [],
      "file",
      storedAt + 30_000,
    );

    expect(lookup.useCachedResponse).toBe(true);
  });

  test("treats missing or invalid Expires values as immediately stale", () => {
    const missingUrl = cacheUrl();
    storeFileCacheResponse(missingUrl, {}, 0, 0, response(missingUrl));

    const invalidUrl = cacheUrl();
    storeFileCacheResponse(
      invalidUrl,
      {},
      0,
      0,
      response(invalidUrl, { expires: "not-a-date" }),
    );

    expect(
      prepareCacheLookup("GET", missingUrl, [], "file", 1).useCachedResponse,
    ).toBe(false);
    expect(
      prepareCacheLookup("GET", invalidUrl, [], "file", 1).useCachedResponse,
    ).toBe(false);
  });

  test("ignores manually persisted entries with Vary: *", () => {
    const url = cacheUrl();
    writeBucket(url, [
      {
        decompress: true,
        statusCode: 200,
        headers: { vary: "*", "cache-control": "max-age=3600" },
        body: Buffer.from("cached").toString("base64"),
        responseUrl: url,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
      },
    ]);

    expect(prepareCacheLookup("GET", url, [], "file", 1).entry).toBeUndefined();
  });

  test("does not store responses with Vary: *", () => {
    const url = cacheUrl();

    storeFileCacheResponse(
      url,
      {},
      0,
      0,
      response(url, { vary: "*", "cache-control": "max-age=3600" }),
    );

    expect(existsSync(getCachePath(url))).toBe(false);
  });

  test("removes malformed cache files and treats them as misses", () => {
    const url = cacheUrl();
    mkdirSync(fileCacheDirectory, { recursive: true });
    writeFileSync(getCachePath(url), "{", "utf8");

    const lookup = prepareCacheLookup("GET", url, [], "file", 0);

    expect(lookup.entry).toBeUndefined();
    expect(existsSync(getCachePath(url))).toBe(false);
  });

  test("retains entries that use different Vary dimensions", () => {
    const url = cacheUrl();

    storeFileCacheResponse(
      url,
      { "x-a": ["a"] },
      0,
      0,
      response(url, { vary: "X-A", "cache-control": "max-age=3600" }),
    );
    storeFileCacheResponse(
      url,
      { "x-a": ["a"], "x-b": ["b"] },
      0,
      0,
      response(url, { vary: "X-A, X-B", "cache-control": "max-age=3600" }),
    );
    storeFileCacheResponse(
      url,
      { "x-b": ["b"], "x-c": ["c"] },
      0,
      0,
      response(url, { vary: "X-B, X-C", "cache-control": "max-age=3600" }),
    );

    const bucket = JSON.parse(readFileSync(getCachePath(url), "utf8")) as {
      entries: unknown[];
    };
    expect(bucket.entries).toHaveLength(3);
  });

  describe.each(["file", "memory"] as const)(
    "%s variant selection",
    (cache) => {
      const earlier = "Fri, 02 Oct 2026 00:00:01 GMT";
      const later = "Fri, 02 Oct 2026 00:00:02 GMT";
      test.each([
        {
          name: "older Date received last",
          firstDate: later,
          secondDate: earlier,
          expected: "first",
        },
        {
          name: "newer Date received last",
          firstDate: earlier,
          secondDate: later,
          expected: "second",
        },
        {
          name: "equal Dates",
          firstDate: earlier,
          secondDate: earlier,
          expected: "second",
        },
        {
          name: "missing Dates",
          firstDate: undefined,
          secondDate: undefined,
          expected: "second",
        },
        {
          name: "invalid Dates",
          firstDate: "invalid",
          secondDate: "invalid",
          expected: "second",
        },
        {
          name: "one missing Date",
          firstDate: later,
          secondDate: undefined,
          expected: "second",
        },
      ])(
        "selects the newest matching response: $name",
        ({ firstDate, secondDate, expected }) => {
          const url = cacheUrl();
          const timestamp = Date.parse("Fri, 02 Oct 2026 00:00:00 GMT");
          const firstHeaders: Record<string, string> = {
            "cache-control": "max-age=3600",
            vary: "X-Missing",
          };
          const secondHeaders: Record<string, string> = {
            "cache-control": "max-age=3600",
          };
          if (firstDate !== undefined) firstHeaders.date = firstDate;
          if (secondDate !== undefined) secondHeaders.date = secondDate;
          storeCacheResponse(
            url,
            {},
            timestamp + 2_000,
            timestamp + 2_000,
            {
              ...response(url, firstHeaders),
              body: Buffer.from("first"),
            },
            cache,
          );
          storeCacheResponse(
            url,
            {},
            timestamp + 3_000,
            timestamp + 3_000,
            {
              ...response(url, secondHeaders),
              body: Buffer.from("second"),
            },
            cache,
          );

          const lookup = prepareCacheLookup(
            "GET",
            url,
            [],
            cache,
            timestamp + 4_000,
          );
          expect(lookup.useCachedResponse).toBe(true);
          if (!lookup.entry) throw new Error("Missing cache entry");
          expect(
            getCachedResponse(lookup.entry, timestamp + 4_000).body.toString(),
          ).toBe(expected);
        },
      );

      test("filters newer nonmatching variants before comparing Dates", () => {
        const url = cacheUrl();
        const timestamp = Date.parse(earlier);
        storeCacheResponse(
          url,
          { "x-a": ["match"] },
          timestamp,
          timestamp,
          {
            ...response(url, {
              "cache-control": "max-age=3600",
              vary: "X-A",
              date: earlier,
            }),
            body: Buffer.from("matching"),
          },
          cache,
        );
        storeCacheResponse(
          url,
          { "x-a": ["other"] },
          timestamp,
          timestamp,
          {
            ...response(url, {
              "cache-control": "max-age=3600",
              vary: "X-A",
              date: later,
            }),
            body: Buffer.from("nonmatching"),
          },
          cache,
        );
        const lookup = prepareCacheLookup(
          "GET",
          url,
          ["X-A: match"],
          cache,
          timestamp + 2_000,
        );
        if (!lookup.entry) throw new Error("Missing cache entry");
        expect(getCachedResponse(lookup.entry).body.toString()).toBe(
          "matching",
        );
      });
    },
  );
});

describe("cache revalidation integrity", () => {
  test.each([
    { etag: '"different"' },
    { etag: 'W/"different"' },
    { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
  ])("rejects conflicting 304 validators %j", (headers) => {
    const { url, lookup } = prepareStaleResponse({
      "cache-control": "max-age=0",
      etag: '"original"',
    });
    expect(() => refreshFileCacheEntry(url, lookup, headers, 2)).toThrow(
      "304 validator",
    );
    expect(prepareCacheLookup("GET", url, [], "file", 3).entry).toBeUndefined();
  });

  test("accepts a weak matching tag and copies updated header arrays", () => {
    const { url, lookup } = prepareStaleResponse({
      "cache-control": "max-age=0",
      etag: '"original"',
    });
    const values = ["one", "two"];
    const refreshed = refreshFileCacheEntry(
      url,
      lookup,
      { etag: 'W/"original"', "x-values": values },
      2,
    );
    values.push("mutated");
    expect(refreshed?.headers["x-values"]).toEqual(["one", "two"]);
  });

  test("rejects an unsolicited weak tag when validating by date", () => {
    const { url, lookup } = prepareStaleResponse({
      "cache-control": "max-age=0",
      "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
    });
    expect(() =>
      refreshFileCacheEntry(url, lookup, { etag: 'W/"new"' }, 2),
    ).toThrow("304 validator");
  });

  test.each([
    { "cache-control": "no-store" },
    { vary: "*" },
    { "set-cookie": ["session=secret"] },
  ])(
    "revokes stored entries when a 304 changes storage policy %j",
    (headers) => {
      const { url, lookup } = prepareStaleResponse({
        "cache-control": "max-age=0",
        etag: '"original"',
      });
      expect(
        refreshFileCacheEntry(url, lookup, headers, 2)?.body.toString(),
      ).toBe("cached");
      expect(
        prepareCacheLookup("GET", url, [], "file", 3).entry,
      ).toBeUndefined();
    },
  );
});

test("an origin no-store response replaces a previously reusable entry", () => {
  const url = cacheUrl();
  storeFreshResponse(url);
  storeFileCacheResponse(
    url,
    {},
    1,
    1,
    response(url, { "cache-control": "no-store" }),
  );
  expect(prepareCacheLookup("GET", url, [], "file", 2).entry).toBeUndefined();
});
