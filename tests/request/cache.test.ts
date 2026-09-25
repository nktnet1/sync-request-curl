import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

let nextCacheKey = 0;
const cacheUrl = (path: string): string => {
  nextCacheKey += 1;
  return `${SERVER_URL}${path}?key=${process.pid}-${Date.now()}-${nextCacheKey}`;
};

type CacheMode = "file" | "memory";

const cachedJson = (
  url: string,
  headers?: Record<string, string>,
  cache: CacheMode = "file",
): unknown => request("GET", url, { cache, headers }).getJSON();

const cachedPair = (path: string, cache: CacheMode = "file") => {
  const url = cacheUrl(path);
  return [
    request("GET", url, { cache }),
    request("GET", url, { cache }),
  ] as const;
};

describe("file cache", () => {
  test("reuses a fresh GET response without contacting the origin", () => {
    const [first, second] = cachedPair("/cache/fresh");

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
  });

  test.for(["/cache/revalidate/etag", "/cache/revalidate/last-modified"])(
    "revalidates stale responses for %s",
    (path) => {
      const [first, second] = cachedPair(path);

      expect(first.getJSON()).toStrictEqual({ hits: 1 });
      expect(second.statusCode).toBe(200);
      expect(second.getJSON()).toStrictEqual({ hits: 1 });
      expect(second.headers["x-origin-hits"]).toBe("2");
    },
  );

  test("Cache-Control: no-cache bypasses freshness and replaces the entry", () => {
    const url = cacheUrl("/cache/fresh");

    expect(cachedJson(url)).toStrictEqual({ hits: 1 });
    expect(cachedJson(url, { "Cache-Control": "no-cache" })).toStrictEqual({
      hits: 2,
    });
    expect(cachedJson(url)).toStrictEqual({ hits: 2 });
  });

  test("preserves caller-supplied conditional requests", () => {
    const url = cacheUrl("/cache/fresh");

    const first = request("GET", url, { cache: "file" });
    const etag = first.headers.etag;
    expect(typeof etag).toBe("string");

    const conditional = request("GET", url, {
      cache: "file",
      headers: { "If-None-Match": etag },
    });

    expect(conditional.statusCode).toBe(304);
    expect(conditional.headers["x-origin-hits"]).toBe("2");
    expect(cachedJson(url)).toStrictEqual({ hits: 1 });
  });

  test("Cache-Control: no-store bypasses reads without replacing the entry", () => {
    const url = cacheUrl("/cache/fresh");

    expect(cachedJson(url)).toStrictEqual({ hits: 1 });
    expect(cachedJson(url, { "Cache-Control": "no-store" })).toStrictEqual({
      hits: 2,
    });
    expect(cachedJson(url)).toStrictEqual({ hits: 1 });
  });

  test("does not store responses marked no-store", () => {
    const url = cacheUrl("/cache/no-store");

    expect(cachedJson(url)).toStrictEqual({ hits: 1 });
    expect(cachedJson(url)).toStrictEqual({ hits: 2 });
  });

  test("honours Vary when matching cached responses", () => {
    const url = cacheUrl("/cache/vary");

    expect(cachedJson(url, { "X-Variant": "a" })).toStrictEqual({
      hits: 1,
      variant: "a",
    });
    expect(cachedJson(url, { "X-Variant": "a" })).toStrictEqual({
      hits: 1,
      variant: "a",
    });
    expect(cachedJson(url, { "X-Variant": "b" })).toStrictEqual({
      hits: 2,
      variant: "b",
    });
    expect(cachedJson(url, { "X-Variant": "a" })).toStrictEqual({
      hits: 1,
      variant: "a",
    });
  });

  test("does not satisfy range requests from a complete cached response", () => {
    const url = cacheUrl("/cache/range");

    const first = request("GET", url, { cache: "file" });
    const ranged = request("GET", url, {
      cache: "file",
      headers: { Range: "bytes=0-0" },
    });
    const third = request("GET", url, { cache: "file" });

    expect(first.getBody("utf8")).toBe("abcdef");
    expect(ranged.statusCode).toBe(206);
    expect(ranged.getBody("utf8")).toBe("a");
    expect(ranged.headers["x-origin-hits"]).toBe("2");
    expect(third.getBody("utf8")).toBe("abcdef");
    expect(third.headers["x-origin-hits"]).toBe("1");
  });

  test("follows cached redirect responses through the normal redirect pipeline", () => {
    const [first, second] = cachedPair("/cache/redirect");

    expect(first.getJSON()).toStrictEqual({ sourceHits: 1, targetHits: 1 });
    expect(second.getJSON()).toStrictEqual({ sourceHits: 1, targetHits: 2 });
  });

  test("invalidates a cached GET after a successful unsafe request", () => {
    const url = cacheUrl("/cache/mutable");

    expect(cachedJson(url)).toStrictEqual({ hits: 1, version: 0 });
    expect(cachedJson(url)).toStrictEqual({ hits: 1, version: 0 });
    expect(request("POST", url, { cache: "file" }).getJSON()).toStrictEqual({
      version: 1,
    });
    expect(cachedJson(url)).toStrictEqual({ hits: 2, version: 1 });
  });
});

describe("memory cache", () => {
  test("reuses a fresh GET response without contacting the origin", () => {
    const [first, second] = cachedPair("/cache/fresh", "memory");

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
  });

  test("revalidates stale responses using the same HTTP cache policy", () => {
    const [first, second] = cachedPair("/cache/revalidate/etag", "memory");

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.statusCode).toBe(200);
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.headers["x-origin-hits"]).toBe("2");
  });

  test("invalidates a cached GET after a successful unsafe request", () => {
    const url = cacheUrl("/cache/mutable");

    expect(cachedJson(url, undefined, "memory")).toStrictEqual({
      hits: 1,
      version: 0,
    });
    expect(cachedJson(url, undefined, "memory")).toStrictEqual({
      hits: 1,
      version: 0,
    });
    expect(request("POST", url, { cache: "memory" }).getJSON()).toStrictEqual({
      version: 1,
    });
    expect(cachedJson(url, undefined, "memory")).toStrictEqual({
      hits: 2,
      version: 1,
    });
  });
});
