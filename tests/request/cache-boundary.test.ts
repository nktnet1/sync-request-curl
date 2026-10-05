import { afterEach, describe, expect, test, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }));
vi.mock("#/native/index", () => ({ default: { request: nativeRequest } }));

import request from "#/index";
import {
  invalidateCache,
  prepareCacheLookup,
  storeCacheResponse,
} from "#/request/cache";
import { getRequestCacheKey } from "#/request/cache-key";
import type {
  CacheCanCacheFunction,
  HttpVerb,
  Options,
  Response,
} from "#/types/definition";

type CacheMode = NonNullable<Options["cache"]>;
const touched = new Map<string, CacheMode>();
const body = Buffer.from("original");
const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
let serial = 0;
const nextUrl = () =>
  `https://cache-boundary.test/${process.pid}-${++serial}/resource`;

const seed = (
  url: string,
  cache: CacheMode,
  headers: Response["headers"] = {},
  options: Options = {},
) => {
  const key = getRequestCacheKey(url, options);
  touched.set(key, cache);
  const now = Date.now();
  storeCacheResponse(
    key,
    {},
    now,
    now,
    {
      statusCode: 200,
      headers: {
        "cache-control": "max-age=3600",
        etag: '"same"',
        "last-modified": lastModified,
        "content-length": String(body.length),
        ...headers,
      },
      body,
      responseUrl: url,
    },
    cache,
  );
  return key;
};

const respond = (
  url: string,
  status: number,
  headers: Record<string, string> = {},
  payload = "",
) => {
  nativeRequest.mockReturnValueOnce({
    transportCode: 0,
    transportMessage: "",
    statusCode: status,
    effectiveUrl: url,
    redirectUrl: null,
    headers: [
      `HTTP/1.1 ${status} Fixture`,
      ...Object.entries({
        "Content-Length": String(Buffer.byteLength(payload)),
        ...headers,
      }).map(([name, value]) => `${name}: ${value}`),
      "",
    ],
    requestHeaderOffsets: [0],
    body: Buffer.from(payload),
  });
};

afterEach(() => {
  nativeRequest.mockReset();
  for (const [key, cache] of touched) invalidateCache(key, cache);
  touched.clear();
});

describe.each(["file", "memory"] as const)(
  "%s cache response boundaries",
  (cache) => {
    test.each([
      { name: "Cache-Control", value: "no-store" },
      { name: "Vary", value: "*" },
      { name: "Set-Cookie", value: "session=secret" },
    ])(
      "a caller's matching 304 revokes storage for $name",
      ({ name, value }) => {
        const url = nextUrl();
        const key = seed(url, cache);
        respond(url, 304, { ETag: '"same"', [name]: value });
        const response = request("GET", url, {
          cache,
          headers: { "If-None-Match": '"same"' },
        });
        expect(response.statusCode).toBe(304);
        expect(response.body).toHaveLength(0);
        expect(prepareCacheLookup("GET", key, [], cache).entry).toBeUndefined();
      },
    );

    test.each([
      {
        condition: "If-None-Match",
        value: '"same"',
        validator: "ETag",
        received: 'W/"same"',
      },
      {
        condition: "If-Modified-Since",
        value: lastModified,
        validator: "Last-Modified",
        received: lastModified,
      },
    ])(
      "a caller's $condition refreshes matching metadata while returning 304",
      ({ condition, value, validator, received }) => {
        const url = nextUrl();
        seed(url, cache, { "cache-control": "max-age=0" });
        respond(url, 304, {
          [validator]: received,
          "Cache-Control": "max-age=60",
          "X-Updated": "yes",
        });
        const conditional = request("GET", url, {
          cache,
          headers: { [condition]: value },
        });
        expect(conditional.statusCode).toBe(304);
        expect(conditional.body).toHaveLength(0);
        const cached = request("GET", url, { cache });
        expect(cached.getBody()).toEqual(body);
        expect(cached.headers["x-updated"]).toBe("yes");
        expect(nativeRequest).toHaveBeenCalledTimes(1);
      },
    );

    test("canCache observes the rebuilt response behind a caller's conditional GET", () => {
      const url = nextUrl();
      const key = seed(url, cache);
      respond(url, 304, { ETag: '"same"', "X-Updated": "yes" });
      const canCache = vi.fn<CacheCanCacheFunction>(
        (response, defaultValue) => {
          expect(response.statusCode).toBe(200);
          expect(response.getBody()).toEqual(body);
          expect(response.headers["x-updated"]).toBe("yes");
          expect(defaultValue).toBe(true);
          return false;
        },
      );
      expect(
        request("GET", url, {
          cache,
          canCache,
          headers: { "If-None-Match": '"same"' },
        }).statusCode,
      ).toBe(304);
      expect(canCache).toHaveBeenCalledTimes(1);
      expect(prepareCacheLookup("GET", key, [], cache).entry).toBeUndefined();
    });

    test("canCache can explicitly approve a changed no-store policy", () => {
      const url = nextUrl();
      seed(url, cache);
      respond(url, 304, {
        ETag: '"same"',
        "Cache-Control": "no-store, max-age=60",
      });
      const canCache = vi.fn<CacheCanCacheFunction>(
        (response, defaultValue) => {
          expect(defaultValue).toBe(false);
          expect(response.getBody()).toEqual(body);
          return true;
        },
      );
      request("GET", url, {
        cache,
        canCache,
        headers: { "If-None-Match": '"same"' },
      });
      expect(request("GET", url, { cache }).headers["cache-control"]).toBe(
        "no-store, max-age=60",
      );
      expect(canCache).toHaveBeenCalledTimes(1);
      expect(nativeRequest).toHaveBeenCalledTimes(1);
    });

    test.each([
      {
        condition: "If-None-Match",
        value: '"other"',
        metadata: { ETag: '"other"' },
      },
      {
        condition: "If-Modified-Since",
        value: lastModified,
        metadata: { "Last-Modified": "Thu, 22 Oct 2015 07:28:00 GMT" },
      },
      { condition: "If-None-Match", value: '"same"', metadata: {} },
      {
        condition: "Cache-Control",
        value: "no-cache",
        metadata: { ETag: '"same"' },
      },
    ])(
      "an unrelated or unproven 304 cannot refresh the stored response: %j",
      ({ condition, value, metadata }) => {
        const url = nextUrl();
        const key = seed(url, cache);
        const headers: Record<string, string> = { "Cache-Control": "no-store" };
        for (const [name, field] of Object.entries(metadata))
          if (field !== undefined) headers[name] = field;
        respond(url, 304, headers);
        expect(
          request("GET", url, { cache, headers: { [condition]: value } })
            .statusCode,
        ).toBe(304);
        expect(
          prepareCacheLookup("GET", key, [], cache).entry?.headers[
            "cache-control"
          ],
        ).toBe("max-age=3600");
      },
    );

    test("request no-store still bypasses metadata updates and canCache", () => {
      const url = nextUrl();
      const key = seed(url, cache);
      respond(url, 304, { ETag: '"same"', "Cache-Control": "max-age=60" });
      const canCache = vi.fn(() => true);
      request("GET", url, {
        cache,
        canCache,
        headers: { "If-None-Match": '"same"', "Cache-Control": "no-store" },
      });
      expect(canCache).not.toHaveBeenCalled();
      expect(
        prepareCacheLookup("GET", key, [], cache).entry?.headers[
          "cache-control"
        ],
      ).toBe("max-age=3600");
    });

    test("POST followed by 303 fetches the updated target instead of reusing its cached body", () => {
      const url = nextUrl();
      const target = new URL("updated", url).href;
      seed(target, cache);
      respond(url, 303, { Location: "updated" });
      respond(target, 200, { "Cache-Control": "max-age=60" }, "updated");
      expect(request("POST", url, { cache }).getBody("utf8")).toBe("updated");
      expect(
        nativeRequest.mock.calls.map(([options]) => [
          options.method,
          options.url,
        ]),
      ).toEqual([
        ["POST", url],
        ["GET", target],
      ]);
    });

    test.each([
      { name: "Location", reference: "related" },
      { name: "Content-Location", reference: "?related" },
      { name: "Content-Location", reference: "../related#fragment" },
    ])(
      "successful writes invalidate same-origin $name references",
      ({ name, reference }) => {
        const url = nextUrl();
        const target = new URL(reference, url).href;
        const key = seed(target, cache);
        respond(url, 201, { [name]: reference });
        request("POST", url, { cache, followRedirects: false });
        expect(prepareCacheLookup("GET", key, [], cache).entry).toBeUndefined();
      },
    );

    test("absolute mixed-dot metadata invalidates both possible targets in the current namespace", () => {
      const url = nextUrl();
      const options = { cacheNamespace: "mutation-boundary" };
      const plain = url;
      const literal = url.replace("/resource", "/dir/resource");
      const related = url.replace("/resource", "/dir/%2e/../resource");
      const keys = [plain, literal].map((target) =>
        seed(target, cache, {}, options),
      );
      const otherNamespace = seed(plain, cache);
      respond(new URL("write", url).href, 200, { "Content-Location": related });
      request("POST", new URL("write", url).href, { ...options, cache });
      for (const key of keys)
        expect(prepareCacheLookup("GET", key, [], cache).entry).toBeUndefined();
      expect(
        prepareCacheLookup("GET", otherNamespace, [], cache).entry,
      ).toBeDefined();
    });

    test.each([
      "https://foreign.test/related",
      "http://cache-boundary.test/related",
      "https://cache-boundary.test:444/related",
      "http://[",
      "https://cache-boundary.test\\@foreign.test/related",
    ])(
      "invalid or cross-origin metadata cannot evict other targets: %s",
      (reference) => {
        const url = nextUrl();
        let protectedUrl = new URL("related", url).href;
        try {
          protectedUrl = new URL(reference, url).href;
        } catch {}
        const protectedKey = seed(protectedUrl, cache);
        respond(url, 201, { Location: reference });
        expect(
          request("POST", url, { cache, followRedirects: false }).statusCode,
        ).toBe(201);
        expect(
          prepareCacheLookup("GET", protectedKey, [], cache).entry,
        ).toBeDefined();
      },
    );

    test.each([
      { method: "POST" as HttpVerb, status: 500 },
      { method: "OPTIONS" as HttpVerb, status: 200 },
      { method: "TRACE" as HttpVerb, status: 200 },
    ])(
      "$method status $status preserves related entries",
      ({ method, status }) => {
        const url = nextUrl();
        const target = new URL("related", url).href;
        const key = seed(target, cache);
        respond(url, status, { "Content-Location": target });
        request(method, url, { cache });
        expect(prepareCacheLookup("GET", key, [], cache).entry).toBeDefined();
      },
    );
  },
);
