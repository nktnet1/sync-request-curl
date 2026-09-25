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
  prepareFileCacheLookup,
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

const writeBucket = (
  url: string,
  entries: Array<Record<string, unknown>>,
): void => {
  mkdirSync(fileCacheDirectory, { recursive: true });
  writeFileSync(
    getCachePath(url),
    JSON.stringify({ version: 1, entries }),
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
  test("ignores malformed request headers and accumulates duplicate values", () => {
    const lookup = prepareFileCacheLookup(
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
      prepareFileCacheLookup("GET", url, ["X-A: a", "X-B: b"], "file", 1)
        .useCachedResponse,
    ).toBe(true);
    expect(
      prepareFileCacheLookup(
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
      prepareFileCacheLookup("GET", url, [], "file", 1).useCachedResponse,
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
      prepareFileCacheLookup("GET", url, [], "file", 1).useCachedResponse,
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

    const lookup = prepareFileCacheLookup("GET", url, [], "file", 2);
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
      prepareFileCacheLookup(
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

  test("returns null for cached redirects without a Location header", () => {
    expect(getCachedRedirectUrl({ statusCode: 302, headers: {} })).toBeNull();
  });

  test("honours request cache directives including empty segments and max-age", () => {
    const url = cacheUrl();
    storeFreshResponse(url);

    const lookup = prepareFileCacheLookup(
      "GET",
      url,
      ["Cache-Control: max-age=3600, , max-age=0"],
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

    const lookup = prepareFileCacheLookup(
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

  test("does not reuse a response marked Cache-Control: no-cache", () => {
    const url = cacheUrl();
    storeFileCacheResponse(
      url,
      {},
      0,
      0,
      response(url, { "cache-control": "no-cache" }),
    );

    const lookup = prepareFileCacheLookup("GET", url, [], "file", 1);

    expect(lookup.entry).toBeDefined();
    expect(lookup.useCachedResponse).toBe(false);
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

    const lookup = prepareFileCacheLookup(
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
      prepareFileCacheLookup("GET", missingUrl, [], "file", 1)
        .useCachedResponse,
    ).toBe(false);
    expect(
      prepareFileCacheLookup("GET", invalidUrl, [], "file", 1)
        .useCachedResponse,
    ).toBe(false);
  });

  test("ignores manually persisted entries with Vary: *", () => {
    const url = cacheUrl();
    writeBucket(url, [
      {
        statusCode: 200,
        headers: { vary: "*", "cache-control": "max-age=3600" },
        body: Buffer.from("cached").toString("base64"),
        responseUrl: url,
        requestHeaders: {},
        requestTimestamp: 0,
        responseTimestamp: 0,
      },
    ]);

    expect(
      prepareFileCacheLookup("GET", url, [], "file", 1).entry,
    ).toBeUndefined();
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

    const lookup = prepareFileCacheLookup("GET", url, [], "file", 0);

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
});
