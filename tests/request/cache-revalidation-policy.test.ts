import { Agent } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";

const { nativeRequest, createConnectionPool, releaseConnectionPool } =
  vi.hoisted(() => ({
    nativeRequest: vi.fn(),
    createConnectionPool: vi.fn(),
    releaseConnectionPool: vi.fn(),
  }));
vi.mock("#/native/index", () => ({
  default: {
    request: nativeRequest,
    createConnectionPool,
    releaseConnectionPool,
  },
}));

import request from "#/index";
import { invalidateCache, prepareCacheLookup } from "#/request/cache";
import { getRequestCacheKey } from "#/request/cache-key";
import type { CacheCanCacheFunction, Options } from "#/types/definition";

let serial = 0;
const touchedKeys = new Map<string, NonNullable<Options["cache"]>>();
const body = Buffer.from('{"source":"original"}');
const approvalCases: {
  headers: Record<string, string>;
  defaultValue: boolean;
}[] = [
  { headers: {}, defaultValue: true },
  {
    headers: { "Cache-Control": "no-store, max-age=60" },
    defaultValue: false,
  },
];

afterEach(() => {
  nativeRequest.mockReset();
  createConnectionPool.mockReset();
  releaseConnectionPool.mockReset();
  for (const [key, cache] of touchedKeys) invalidateCache(key, cache);
  touchedKeys.clear();
});

const queueRevalidation = (
  cache: NonNullable<Options["cache"]>,
  headers: Record<string, string> = {},
) => {
  const url = `https://cache-policy.test/${process.pid}-${++serial}`;
  const key = getRequestCacheKey(url, {});
  touchedKeys.set(key, cache);
  nativeRequest
    .mockReturnValueOnce({
      transportCode: 0,
      transportMessage: "",
      statusCode: 200,
      effectiveUrl: url,
      redirectUrl: null,
      headers: [
        "HTTP/1.1 200 OK",
        'ETag: "same"',
        "Cache-Control: max-age=0",
        `Content-Length: ${body.length}`,
        "",
      ],
      body,
    })
    .mockReturnValueOnce({
      transportCode: 0,
      transportMessage: "",
      statusCode: 304,
      effectiveUrl: url,
      redirectUrl: null,
      headers: [
        "HTTP/1.1 304 Not Modified",
        'ETag: "same"',
        ...Object.entries({ "Cache-Control": "max-age=60", ...headers }).map(
          ([name, value]) => `${name}: ${value}`,
        ),
        "",
      ],
      body: Buffer.alloc(0),
    });
  expect(request("GET", url, { cache }).getJSON()).toEqual({
    source: "original",
  });
  return { url, key };
};

describe.each(["file", "memory"] as const)(
  "%s revalidation cache policy",
  (cache) => {
    test("canCache can reject updated metadata without losing the current response body", () => {
      const { url, key } = queueRevalidation(cache, {
        "X-Do-Not-Cache": "yes",
      });
      const canCache = vi.fn<CacheCanCacheFunction>(
        (response, defaultValue) => {
          expect(defaultValue).toBe(true);
          expect(response.statusCode).toBe(200);
          expect(response.url).toBe(url);
          expect(response.getJSON()).toEqual({ source: "original" });
          return response.headers["x-do-not-cache"] === undefined;
        },
      );
      const refreshed = request("GET", url, { cache, canCache });
      expect(refreshed.getBody()).toEqual(body);
      expect(canCache).toHaveBeenCalledTimes(1);
      expect(nativeRequest.mock.calls[1]?.[0].headers).toContain(
        'If-None-Match: "same"',
      );
      expect(prepareCacheLookup("GET", key, [], cache).entry).toBeUndefined();
    });

    test.each(approvalCases)(
      "canCache can approve the rebuilt response with default=$defaultValue",
      ({ headers, defaultValue }) => {
        const { url } = queueRevalidation(cache, headers);
        const canCache = vi.fn<CacheCanCacheFunction>(
          (response, actualDefault) => {
            expect(actualDefault).toBe(defaultValue);
            expect(response.getJSON()).toEqual({ source: "original" });
            return true;
          },
        );
        const refreshed = request("GET", url, { cache, canCache });
        const cached = request("GET", url, { cache });
        expect(cached.getBody()).toEqual(refreshed.getBody());
        expect(cached.headers["cache-control"]).toBe(
          refreshed.headers["cache-control"],
        );
        expect(nativeRequest).toHaveBeenCalledTimes(2);
        expect(canCache).toHaveBeenCalledTimes(1);
      },
    );

    test("a throwing canCache does not write the refreshed metadata", () => {
      const { url, key } = queueRevalidation(cache, { "X-Updated": "yes" });
      const failure = new Error("cache policy failed");
      expect(() =>
        request("GET", url, {
          cache,
          canCache: () => {
            throw failure;
          },
        }),
      ).toThrow(failure);
      const lookup = prepareCacheLookup("GET", key, [], cache);
      expect(lookup.useCachedResponse).toBe(false);
      expect(lookup.entry?.headers["x-updated"]).toBeUndefined();
      expect(lookup.entry?.headers["cache-control"]).toBe("max-age=0");
    });

    test("an ambiguous authority cannot reuse a cached response or call cache hooks", () => {
      const { url, key } = queueRevalidation(cache);
      const ambiguousUrl = url.replace(
        "cache-policy.test",
        "cache-policy.test\\@other.test",
      );
      const isExpired = vi.fn(() => false);
      expect(() => request("GET", ambiguousUrl, { cache, isExpired })).toThrow(
        "ambiguous authority",
      );
      expect(isExpired).not.toHaveBeenCalled();
      expect(nativeRequest).toHaveBeenCalledTimes(1);
      expect(prepareCacheLookup("GET", key, [], cache).entry).toBeDefined();
    });

    test("a caller's conditional HEAD response does not refresh GET metadata", () => {
      const { url, key } = queueRevalidation(cache, { "X-Updated": "yes" });
      const response = request("HEAD", url, {
        cache,
        headers: { "If-None-Match": '"same"' },
      });
      expect(response.statusCode).toBe(304);
      const lookup = prepareCacheLookup("GET", key, [], cache);
      expect(lookup.useCachedResponse).toBe(false);
      expect(lookup.entry?.headers["x-updated"]).toBeUndefined();
      expect(lookup.entry?.headers["cache-control"]).toBe("max-age=0");
    });

    test("a failed mutation preserves the stored GET response", () => {
      const { url, key } = queueRevalidation(cache);
      nativeRequest.mockReset().mockReturnValue({
        transportCode: 0,
        transportMessage: "",
        statusCode: 500,
        effectiveUrl: url,
        redirectUrl: null,
        headers: [
          "HTTP/1.1 500 Internal Server Error",
          "Content-Length: 0",
          "",
        ],
        body: Buffer.alloc(0),
      });
      expect(request("POST", url, { cache }).statusCode).toBe(500);
      expect(prepareCacheLookup("GET", key, [], cache).entry?.body).toBe(
        body.toString("base64"),
      );
    });

    test("revalidation uses the configured agent's connection pool", () => {
      const { url } = queueRevalidation(cache);
      const agent = new Agent({ keepAlive: true, maxTotalSockets: 3 });
      createConnectionPool.mockReturnValue(17);
      try {
        const response = request("GET", url, { cache, agent });
        expect(response.getBody()).toEqual(body);
        expect(nativeRequest.mock.calls[1]?.[0].connectionPoolId).toBe(17);
        expect(createConnectionPool).toHaveBeenCalledExactlyOnceWith(3);
      } finally {
        agent.destroy();
      }
      expect(releaseConnectionPool).toHaveBeenCalledExactlyOnceWith(17);
    });
  },
);
