import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

let nextCacheKey = 0;
const cacheUrl = (path: string): string => {
  nextCacheKey += 1;
  return `${SERVER_URL}${path}?key=${process.pid}-${Date.now()}-${nextCacheKey}`;
};

describe("file cache", () => {
  test("reuses a fresh GET response without contacting the origin", () => {
    const url = cacheUrl("/cache/fresh");

    const first = request("GET", url, { cache: "file" });
    const second = request("GET", url, { cache: "file" });

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
  });

  test("revalidates stale ETag responses and returns the cached entity", () => {
    const url = cacheUrl("/cache/revalidate/etag");

    const first = request("GET", url, { cache: "file" });
    const second = request("GET", url, { cache: "file" });

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.statusCode).toBe(200);
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.headers["x-origin-hits"]).toBe("2");
  });

  test("revalidates stale Last-Modified responses", () => {
    const url = cacheUrl("/cache/revalidate/last-modified");

    const first = request("GET", url, { cache: "file" });
    const second = request("GET", url, { cache: "file" });

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.statusCode).toBe(200);
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.headers["x-origin-hits"]).toBe("2");
  });

  test("Cache-Control: no-cache bypasses freshness and replaces the entry", () => {
    const url = cacheUrl("/cache/fresh");

    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
    });
    expect(
      request("GET", url, {
        cache: "file",
        headers: { "Cache-Control": "no-cache" },
      }).getJSON(),
    ).toStrictEqual({ hits: 2 });
    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 2,
    });
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
    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
    });
  });

  test("Cache-Control: no-store bypasses reads without replacing the entry", () => {
    const url = cacheUrl("/cache/fresh");

    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
    });
    expect(
      request("GET", url, {
        cache: "file",
        headers: { "Cache-Control": "no-store" },
      }).getJSON(),
    ).toStrictEqual({ hits: 2 });
    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
    });
  });

  test("does not store responses marked no-store", () => {
    const url = cacheUrl("/cache/no-store");

    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
    });
    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 2,
    });
  });

  test("honours Vary when matching cached responses", () => {
    const url = cacheUrl("/cache/vary");

    expect(
      request("GET", url, {
        cache: "file",
        headers: { "X-Variant": "a" },
      }).getJSON(),
    ).toStrictEqual({ hits: 1, variant: "a" });
    expect(
      request("GET", url, {
        cache: "file",
        headers: { "X-Variant": "a" },
      }).getJSON(),
    ).toStrictEqual({ hits: 1, variant: "a" });
    expect(
      request("GET", url, {
        cache: "file",
        headers: { "X-Variant": "b" },
      }).getJSON(),
    ).toStrictEqual({ hits: 2, variant: "b" });
    expect(
      request("GET", url, {
        cache: "file",
        headers: { "X-Variant": "a" },
      }).getJSON(),
    ).toStrictEqual({ hits: 1, variant: "a" });
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
    const url = cacheUrl("/cache/redirect");

    const first = request("GET", url, { cache: "file" });
    const second = request("GET", url, { cache: "file" });

    expect(first.getJSON()).toStrictEqual({ sourceHits: 1, targetHits: 1 });
    expect(second.getJSON()).toStrictEqual({ sourceHits: 1, targetHits: 2 });
  });

  test("invalidates a cached GET after a successful unsafe request", () => {
    const url = cacheUrl("/cache/mutable");

    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
      version: 0,
    });
    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 1,
      version: 0,
    });
    expect(request("POST", url, { cache: "file" }).getJSON()).toStrictEqual({
      version: 1,
    });
    expect(request("GET", url, { cache: "file" }).getJSON()).toStrictEqual({
      hits: 2,
      version: 1,
    });
  });
});
