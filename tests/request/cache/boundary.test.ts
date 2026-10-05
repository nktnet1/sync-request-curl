import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCacheTracker } from "#tests/request/cache/cleanup";

const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }));
vi.mock("#/native/index", () => ({ default: { request: nativeRequest } }));

import request from "#/index";
import { prepareCacheLookup, storeCacheResponse } from "#/request/cache";
import { getRequestCacheKey } from "#/request/cache-key";
import { fileCacheDirectory, getCachePath } from "#/request/cache-path";
import type {
  CacheCanCacheFunction,
  HttpVerb,
  Options,
  Response,
} from "#/types/definition";

type CacheMode = NonNullable<Options["cache"]>;
const trackCache = createCacheTracker();
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
  trackCache(key, cache);
  const now = Date.now();
  const storedHeaders: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined)
      storedHeaders[name.toLowerCase()] = Array.isArray(value)
        ? value
        : [value];
  }
  storeCacheResponse(
    key,
    storedHeaders,
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
    { decompress: options.gzip !== false },
  );
  return key;
};

const seedVariant = (
  url: string,
  cache: CacheMode,
  name: string,
  value: string,
  headers: Response["headers"] = {},
) =>
  seed(url, cache, { ...headers, vary: name }, { headers: { [name]: value } });

const lookupStored = (
  url: string,
  cache: CacheMode,
  headers: Record<string, string> = {},
  options: Options = {},
) =>
  prepareCacheLookup(
    "GET",
    getRequestCacheKey(url, options),
    Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    cache,
    Date.now(),
    options.gzip !== false,
  );

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

const rejectModifiedGet = (
  url: string,
  cache: CacheMode,
  headers: Record<string, string>,
  status = 200,
): void => {
  seed(url, cache);
  respond(url, status, { ETag: '"new"', "Cache-Control": "max-age=60" }, "new");
  request("GET", url, { cache, headers, canCache: () => false });
};

afterEach(() => nativeRequest.mockReset());

test.each([4, 5])("legacy file cache version %i is retired", (version) => {
  const url = nextUrl();
  const options = { cacheNamespace: url };
  const legacyKey = JSON.stringify([options.cacheNamespace, version, url, url]);
  const legacyPath = getCachePath(
    JSON.stringify([options.cacheNamespace, version, url]),
  );
  const now = Date.now();
  mkdirSync(fileCacheDirectory, { recursive: true });
  writeFileSync(
    legacyPath,
    JSON.stringify({
      version: 2,
      entries: [
        {
          cacheKey: legacyKey,
          decompress: true,
          statusCode: 200,
          headers: { "cache-control": "max-age=3600" },
          body: body.toString("base64"),
          responseUrl: url,
          requestHeaders: {},
          requestTimestamp: now,
          responseTimestamp: now,
        },
      ],
    }),
  );
  trackCache(getRequestCacheKey(url, options), "file");
  try {
    respond(url, 200, { "Cache-Control": "max-age=60" }, "new");
    expect(
      request("GET", url, { cache: "file", ...options }).getBody("utf8"),
    ).toBe("new");
    expect(nativeRequest).toHaveBeenCalledTimes(1);
  } finally {
    rmSync(legacyPath, { force: true });
  }
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

    test.each(["caller", "automatic"] as const)(
      "%s 304 replaces the old Vary definition without retaining a reusable copy",
      (condition) => {
        const url = nextUrl();
        seed(
          url,
          cache,
          {
            vary: "X-Shape",
            "cache-control":
              condition === "automatic" ? "max-age=0" : "max-age=3600",
          },
          { headers: { "X-Shape": "round" } },
        );
        respond(url, 304, {
          ETag: '"same"',
          Vary: "X-Color",
          "Cache-Control": "max-age=60",
        });
        const headers: Record<string, string> = {
          "X-Shape": "round",
          "X-Color": "blue",
        };
        if (condition === "caller") headers["If-None-Match"] = '"same"';
        const validated = request("GET", url, { cache, headers });
        expect(validated.statusCode).toBe(condition === "caller" ? 304 : 200);
        expect(
          request("GET", url, {
            cache,
            headers: { "X-Shape": "round", "X-Color": "blue" },
          }).getBody(),
        ).toEqual(body);
        respond(
          url,
          200,
          { ETag: '"red"', Vary: "X-Color", "Cache-Control": "max-age=60" },
          "red",
        );
        expect(
          request("GET", url, {
            cache,
            headers: { "X-Shape": "round", "X-Color": "red" },
          }).getBody("utf8"),
        ).toBe("red");
        expect(nativeRequest).toHaveBeenCalledTimes(2);
      },
    );

    test.each([
      {
        validator: "strong",
        storedTag: '"same"',
        received: { ETag: '"same"' },
        retainOlder: false,
      },
      {
        validator: "weak",
        storedTag: '"same"',
        received: { ETag: 'W/"same"' },
        retainOlder: true,
      },
      {
        validator: "date",
        storedTag: undefined,
        received: { "Last-Modified": lastModified },
        retainOlder: true,
      },
    ])(
      "$validator validation replaces the identified copies and keeps unrelated variants",
      ({ storedTag, received, retainOlder }) => {
        const url = nextUrl();
        seedVariant(url, cache, "X-Shape", "square", { etag: storedTag });
        seedVariant(url, cache, "X-Other", "different", { etag: '"other"' });
        seedVariant(url, cache, "X-Shape", "round", { etag: storedTag });
        seedVariant(url, cache, "X-Size", "large", { etag: storedTag });
        const validationHeaders: Record<string, string> = {
          Vary: "X-Color",
          "Cache-Control": "max-age=60",
        };
        for (const [name, value] of Object.entries(received))
          if (value !== undefined) validationHeaders[name] = value;
        respond(url, 304, validationHeaders);
        expect(
          request("GET", url, {
            cache,
            headers: {
              "X-Shape": "round",
              "X-Size": "large",
              "X-Color": "blue",
              "X-Other": "different",
              "If-Modified-Since": lastModified,
            },
          }).statusCode,
        ).toBe(304);
        expect(
          lookupStored(url, cache, { "X-Size": "large" }).entry,
        ).toBeUndefined();
        expect(
          lookupStored(url, cache, { "X-Shape": "round" }).entry !== undefined,
        ).toBe(retainOlder);
        expect(
          lookupStored(url, cache, { "X-Shape": "square" }).entry,
        ).toBeDefined();
        expect(
          lookupStored(url, cache, { "X-Other": "different" }).entry?.headers
            .etag,
        ).toBe('"other"');
        expect(
          lookupStored(url, cache, { "X-Color": "blue" }).useCachedResponse,
        ).toBe(true);
      },
    );

    test.each(
      [200, 201, 202, 203, 204, 205, 207, 208].flatMap((status) =>
        [false, true].map((approved) => ({ status, approved })),
      ),
    )(
      "a $status GET replaces old variants when canCache returns $approved",
      ({ status, approved }) => {
        const url = nextUrl();
        const payload = status === 204 || status === 205 ? "" : "new";
        seedVariant(url, cache, "X-Shape", "square");
        seedVariant(url, cache, "X-Shape", "round");
        seedVariant(url, cache, "X-Size", "large");
        respond(
          url,
          status,
          { ETag: '"new"', Vary: "X-Color", "Cache-Control": "max-age=60" },
          payload,
        );
        const canCache = vi.fn<CacheCanCacheFunction>(
          (response, defaultValue) => {
            expect(response.statusCode).toBe(status);
            expect(response.getBody("utf8")).toBe(payload);
            expect(defaultValue).toBe(true);
            return approved;
          },
        );
        const headers = {
          "X-Shape": "round",
          "X-Size": "large",
          "X-Color": "blue",
        };
        expect(
          request("GET", url, {
            cache,
            canCache,
            headers: { ...headers, "If-None-Match": '"same"' },
          }).getBody("utf8"),
        ).toBe(payload);
        expect(
          lookupStored(url, cache, { "X-Shape": "round" }).entry,
        ).toBeUndefined();
        expect(
          lookupStored(url, cache, { "X-Size": "large" }).entry,
        ).toBeUndefined();
        expect(
          lookupStored(url, cache, { "X-Shape": "square" }).entry,
        ).toBeDefined();
        if (!approved)
          respond(
            url,
            status,
            { ETag: '"new"', "Cache-Control": "max-age=60" },
            payload,
          );
        expect(request("GET", url, { cache, headers }).getBody("utf8")).toBe(
          payload,
        );
        expect(canCache).toHaveBeenCalledTimes(1);
        expect(nativeRequest).toHaveBeenCalledTimes(approved ? 1 : 2);
      },
    );

    test.each([200, 203])(
      "rejecting a modified %i body preserves other decoding modes and exact URL spellings",
      (status) => {
        const url = nextUrl();
        const alias = url.replace("/resource", "/dir/%2e%2e/resource");
        seed(alias, cache);
        seed(url, cache, {}, { gzip: false });
        rejectModifiedGet(url, cache, { "If-None-Match": '"same"' }, status);
        expect(lookupStored(url, cache).entry).toBeUndefined();
        expect(lookupStored(alias, cache).entry).toBeDefined();
        expect(
          lookupStored(url, cache, {}, { gzip: false }).entry,
        ).toBeDefined();
      },
    );

    test.each([200, 203])(
      "a rejected modified %i GET removes an otherwise empty cache bucket",
      (status) => {
        const url = nextUrl();
        rejectModifiedGet(url, cache, { "Cache-Control": "no-cache" }, status);
        expect(lookupStored(url, cache).entry).toBeUndefined();
      },
    );

    test.each([206, 226, 412, 500])(
      "a rejected %i response preserves the existing representation",
      (status) => {
        const url = nextUrl();
        seed(url, cache);
        respond(url, status);
        request("GET", url, {
          cache,
          headers: { "If-None-Match": '"same"' },
          canCache: () => false,
        });
        expect(lookupStored(url, cache).entry?.headers.etag).toBe('"same"');
        expect(nativeRequest).toHaveBeenCalledTimes(1);
      },
    );

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
        let protectedUrl: string;
        try {
          protectedUrl = new URL(reference, url).href;
        } catch {
          protectedUrl = new URL("related", url).href;
        }
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
