import { describe, expect, test } from "vitest";
import request from "#/index";
import { storeCacheResponse } from "#/request/cache";
import { FRAMING_SERVER_URL, SERVER_URL } from "#tests/app/config";

let nextCacheKey = 0;
const cacheUrl = (path: string, baseUrl = SERVER_URL): string => {
  nextCacheKey += 1;
  return `${baseUrl}${path}?key=${process.pid}-${Date.now()}-${nextCacheKey}`;
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

test.for(["file", "memory"] as const)(
  "%s cache reuses a fresh GET response without contacting the origin",
  (cache) => {
    const [first, second] = cachedPair("/cache/fresh", cache);

    expect(first.getJSON()).toStrictEqual({ hits: 1 });
    expect(second.getJSON()).toStrictEqual({ hits: 1 });
  },
);

test.for(["file", "memory"] as const)(
  "%s cache keeps encoded dot paths separate from ordinary paths",
  (cache) => {
    const plainUrl = cacheUrl(
      "/regressions/cache/resource",
      FRAMING_SERVER_URL,
    );
    const encodedUrl = plainUrl.replace("/resource", "/dir/%2e%2e/resource");
    // Compare with the active transport: builds can normalize encoded dots
    // differently, including in the effective URL. Each key must still make
    // its own initial origin request and then reuse its own cached response.
    const warmed = [encodedUrl, plainUrl].map((url) => {
      const uncached = request("GET", url);
      const { hits, target } = uncached.getJSON<{
        hits: number;
        target: string;
      }>();
      const response = request("GET", url, { cache });
      expect(response.getJSON()).toStrictEqual({ hits: hits + 1, target });
      expect(response.url).toBe(uncached.url);
      return { url, response };
    });
    for (let pass = 0; pass < 2; pass += 1) {
      for (const { url, response: original } of warmed) {
        const cached = request("GET", url, { cache });
        expect(cached.getJSON()).toStrictEqual(original.getJSON());
        expect(cached.url).toBe(original.url);
      }
    }
  },
);

test.for(["file", "memory"] as const)(
  "%s cache invalidates equivalent literal dot paths after an unsafe request",
  (cache) => {
    const url = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
    const alias = url.replace("/resource", "/dir/../resource");
    expect(request("GET", url, { cache }).getJSON()).toMatchObject({ hits: 1 });
    request("POST", alias, { cache });
    expect(request("GET", url, { cache }).getJSON()).toMatchObject({ hits: 3 });
  },
);

test.for([
  { cache: "file" as const, encodedWrite: false },
  { cache: "file" as const, encodedWrite: true },
  { cache: "memory" as const, encodedWrite: false },
  { cache: "memory" as const, encodedWrite: true },
])(
  "$cache cache invalidates all encoded aliases (encoded write: $encodedWrite)",
  ({ cache, encodedWrite }) => {
    const plain = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
    const urls = [
      plain,
      ...["%2e%2e", "%2E%2E", ".%2e"].map((dots) =>
        plain.replace("/resource", `/dir/${dots}/resource`),
      ),
    ];
    const warmed = urls.map((url) =>
      request("GET", url, { cache }).getJSON<{ hits: number }>(),
    );
    const unrelated = cacheUrl(
      "/regressions/cache/resource",
      FRAMING_SERVER_URL,
    );
    const unrelatedBody = request("GET", unrelated, { cache }).getJSON();
    request("POST", urls[encodedWrite ? 1 : 0], { cache });
    for (const [index, url] of urls.entries()) {
      const fresh = request("GET", url, { cache }).getJSON<{ hits: number }>();
      expect(fresh.hits).toBeGreaterThan(warmed[index].hits);
      expect(request("GET", url, { cache }).getJSON()).toStrictEqual(fresh);
    }
    expect(request("GET", unrelated, { cache }).getJSON()).toStrictEqual(
      unrelatedBody,
    );
  },
);

test.for(["file", "memory"] as const)(
  "%s cache bypasses ambiguous mixed dots and invalidates both possible targets",
  (cache) => {
    const plain = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
    const literal = plain.replace("/resource", "/dir/resource");
    const mixed = plain.replace("/resource", "/dir/%2e/../resource");
    const before = [plain, literal].map((url) =>
      request("GET", url, { cache }).getJSON<{ hits: number }>(),
    );
    const first = request("GET", mixed, { cache }).getJSON<{ hits: number }>();
    const second = request("GET", mixed, { cache }).getJSON<{ hits: number }>();
    expect(second.hits).toBe(first.hits + 1);
    request("POST", mixed, { cache });
    for (const [index, url] of [plain, literal].entries()) {
      expect(
        request("GET", url, { cache }).getJSON<{ hits: number }>().hits,
      ).toBeGreaterThan(before[index].hits);
    }
  },
);

test.for(["file", "memory"] as const)(
  "%s cache does not reuse entries written under the previous colliding keys",
  (cache) => {
    const url = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
    const cacheNamespace = "legacy-cache-regression";
    const now = Date.now();
    storeCacheResponse(
      JSON.stringify([cacheNamespace, url]),
      {},
      now,
      now,
      {
        statusCode: 200,
        headers: { "cache-control": "max-age=3600" },
        body: Buffer.from("wrong cached resource"),
        responseUrl: url.replace("/resource", "/dir/%2e%2e/resource"),
      },
      cache,
    );
    const response = request("GET", url, { cache, cacheNamespace });
    expect(response.getJSON()).toMatchObject({ hits: 1 });
    expect(response.url).toBe(url);
  },
);

test.for(["file", "memory"] as const)(
  "%s cache preserves origin precondition failures",
  (cache) => {
    for (const headers of [
      { "If-Match": '"different"' },
      { "If-Unmodified-Since": "Tue, 20 Oct 2015 07:28:00 GMT" },
    ]) {
      const url = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
      expect(request("GET", url, { cache }).statusCode).toBe(200);
      const conditional = request("GET", url, { cache, headers });
      expect(conditional.statusCode).toBe(412);
      expect(conditional.headers["cache-control"]).toBe("max-age=3600");
      expect(conditional.getJSON()).toMatchObject({ hits: 2 });
      expect(request("GET", url, { cache }).getJSON()).toMatchObject({
        hits: 1,
      });
      const cold = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
      expect(request("GET", cold, { cache, headers }).statusCode).toBe(412);
      const ordinary = request("GET", cold, { cache });
      expect(ordinary.statusCode).toBe(200);
      expect(ordinary.getJSON()).toMatchObject({ hits: 2 });
      expect(request("GET", cold, { cache }).getJSON()).toStrictEqual(
        ordinary.getJSON(),
      );
    }
  },
);

test.for(["file", "memory"] as const)(
  "%s cache discards a GET body when HEAD reports a changed validator",
  (cache) => {
    const url = cacheUrl("/regressions/cache/mutable", FRAMING_SERVER_URL);
    const original = request("GET", url, { cache });
    expect(original.getJSON()).toMatchObject({ version: 0 });
    request("POST", url);
    const head = request("HEAD", url, { cache });
    expect(head.body).toHaveLength(0);
    expect(head.headers.etag).not.toBe(original.headers.etag);
    expect(request("GET", url, { cache }).getJSON()).toMatchObject({
      version: 1,
      hits: 4,
    });
  },
);

test.for(["file", "memory"] as const)(
  "%s cache retains the GET body when HEAD validators and length match",
  (cache) => {
    const url = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
    const original = request("GET", url, { cache });
    const head = request("HEAD", url, { cache });
    expect(head.body).toHaveLength(0);
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0);
    const cached = request("GET", url, { cache });
    expect(cached.body).toStrictEqual(original.body);
    expect(cached.getJSON()).toMatchObject({ hits: 1 });
  },
);

test.for(["file", "memory"] as const)(
  "%s cache invalidates both possible targets after an ambiguous HEAD",
  (cache) => {
    const plain = cacheUrl("/regressions/cache/resource", FRAMING_SERVER_URL);
    const literal = plain.replace("/resource", "/dir/resource");
    const mixed = plain.replace("/resource", "/dir/%2e/../resource");
    const before = [plain, literal].map((url) =>
      request("GET", url, { cache }).getJSON<{ hits: number }>(),
    );
    expect(request("HEAD", mixed, { cache }).statusCode).toBe(200);
    for (const [index, url] of [plain, literal].entries()) {
      expect(
        request("GET", url, { cache }).getJSON<{ hits: number }>().hits,
      ).toBeGreaterThan(before[index].hits);
    }
  },
);

test.for(["file", "memory"] as const)(
  "%s cache honours the first duplicate response max-age",
  (cache) => {
    const url = cacheUrl("/regressions/cache/duplicate", FRAMING_SERVER_URL);
    expect(request("GET", url, { cache }).getJSON()).toMatchObject({ hits: 1 });
    expect(request("GET", url, { cache }).getJSON()).toMatchObject({ hits: 2 });
  },
);

test.for(["file", "memory"] as const)(
  "%s cache supports synchronous cache policy hooks",
  (cache) => {
    const varyUrl = cacheUrl("/cache/vary");
    expect(
      request("GET", varyUrl, {
        cache,
        headers: { "X-Variant": "a", "X-Multi": ["one", "two"] },
      }).getJSON(),
    ).toStrictEqual({
      hits: 1,
      variant: "a",
    });

    let matchCalls = 0;
    const matched = request("GET", varyUrl, {
      cache,
      headers: { "X-Variant": "b" },
      isMatch: (requestHeaders, cachedResponse, defaultValue) => {
        matchCalls += 1;
        expect(defaultValue).toBe(false);
        expect(requestHeaders["x-variant"]).toBe("b");
        expect(cachedResponse.requestHeaders["x-variant"]).toBe("a");
        expect(cachedResponse.requestHeaders["x-multi"]).toStrictEqual([
          "one",
          "two",
        ]);
        expect(cachedResponse.body.toString()).toContain('"variant":"a"');

        // Callback inputs are copies and cannot mutate the stored entry.
        cachedResponse.body.fill(0);
        cachedResponse.headers["cache-control"] = "no-store";
        return true;
      },
    });
    expect(matchCalls).toBe(1);
    expect(matched.getJSON()).toStrictEqual({ hits: 1, variant: "a" });
    expect(cachedJson(varyUrl, { "X-Variant": "a" }, cache)).toStrictEqual({
      hits: 1,
      variant: "a",
    });

    const staleUrl = cacheUrl("/cache/revalidate/etag");
    expect(cachedJson(staleUrl, undefined, cache)).toStrictEqual({ hits: 1 });

    let expiredCalls = 0;
    const stale = request("GET", staleUrl, {
      cache,
      isExpired: (cachedResponse, defaultValue) => {
        expiredCalls += 1;
        expect(defaultValue).toBe(true);
        expect(cachedResponse.statusCode).toBe(200);
        return false;
      },
    });
    expect(expiredCalls).toBe(1);
    expect(stale.getJSON()).toStrictEqual({ hits: 1 });
    expect(stale.headers["x-origin-hits"]).toBe("1");

    const forcedStoreUrl = cacheUrl("/cache/no-store-fresh");
    let canCacheCalls = 0;
    const forcedStore = request("GET", forcedStoreUrl, {
      cache,
      canCache: (response, defaultValue) => {
        canCacheCalls += 1;
        expect(defaultValue).toBe(false);
        expect(response.getJSON()).toStrictEqual({ hits: 1 });
        return true;
      },
    });
    expect(forcedStore.getJSON()).toStrictEqual({ hits: 1 });
    expect(canCacheCalls).toBe(1);
    expect(cachedJson(forcedStoreUrl, undefined, cache)).toStrictEqual({
      hits: 1,
    });

    const blockedStoreUrl = cacheUrl("/cache/fresh");
    const blockStore = (defaultValues: boolean[]) =>
      request("GET", blockedStoreUrl, {
        cache,
        canCache: (_response, defaultValue) => {
          defaultValues.push(defaultValue);
          return false;
        },
      }).getJSON();
    const defaultValues: boolean[] = [];
    expect(blockStore(defaultValues)).toStrictEqual({ hits: 1 });
    expect(blockStore(defaultValues)).toStrictEqual({ hits: 2 });
    expect(defaultValues).toStrictEqual([true, true]);
  },
);

test.for([
  { cache: "file" as const, path: "/cache/revalidate/etag" },
  { cache: "file" as const, path: "/cache/revalidate/last-modified" },
  { cache: "memory" as const, path: "/cache/revalidate/etag" },
])("$cache cache revalidates stale responses for $path", ({ cache, path }) => {
  const [first, second] = cachedPair(path, cache);

  expect(first.getJSON()).toStrictEqual({ hits: 1 });
  expect(second.statusCode).toBe(200);
  expect(second.getJSON()).toStrictEqual({ hits: 1 });
  expect(second.headers["x-origin-hits"]).toBe("2");
});

test.for(["file", "memory"] as const)(
  "%s cache stores a complete redirect response before following it",
  (cache) => {
    const url = cacheUrl("/cache/redirect-body");

    const followed = request("GET", url, { cache });
    const cachedRedirect = request("GET", url, {
      cache,
      followRedirects: false,
    });

    expect(followed.statusCode).toBe(200);
    expect(cachedRedirect.statusCode).toBe(302);
    expect(cachedRedirect.body.toString()).toBe("redirect body 1");
    expect(cachedRedirect.headers["content-length"]).toBe("15");
  },
);

describe("file cache", () => {
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

  test("returns a cached redirect when redirect following is disabled", () => {
    const url = cacheUrl("/cache/redirect");
    const options = { cache: "file" as const, followRedirects: false };

    const first = request("GET", url, options);
    const second = request("GET", url, options);

    expect(first.statusCode).toBe(302);
    expect(second.statusCode).toBe(302);
    expect(second.headers.location).toBe(first.headers.location);
    expect(second.headers.location).toContain("sourceHits=1");
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

test.for(["file", "memory"] as const)(
  "%s isolates namespaces and bypasses personalized requests",
  (cache) => {
    const url = cacheUrl("/cache/fresh");
    const fetch = (cacheNamespace: string, headers?: Record<string, string>) =>
      request("GET", url, { cache, cacheNamespace, headers }).getJSON();
    expect(fetch("a")).toEqual({ hits: 1 });
    expect(fetch("b")).toEqual({ hits: 2 });
    expect(fetch("a")).toEqual({ hits: 1 });
    expect(fetch("a", { Authorization: "Bearer one" })).toEqual({ hits: 3 });
    expect(fetch("a", { Authorization: "Bearer two" })).toEqual({ hits: 4 });
    expect(fetch("a", { Cookie: "user=one" })).toEqual({ hits: 5 });
    expect(fetch("a")).toEqual({ hits: 1 });
  },
);

test("unsafe requests invalidate fragment variants of the same resource", () => {
  const url = cacheUrl("/cache/mutable");
  const first = request("GET", `${url}#one`, { cache: "memory" }).getJSON();
  request("POST", `${url}#two`, {
    cache: "memory",
    json: { value: "updated" },
  });
  expect(
    request("GET", `${url}#one`, { cache: "memory" }).getJSON(),
  ).not.toEqual(first);
});
