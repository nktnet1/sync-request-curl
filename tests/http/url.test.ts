import { describe, expect, test } from "vitest";
import {
  appendQueryString,
  assertSupportedHttpUrl,
  normalizeUrlHostname,
} from "#/http/url";

describe("normalizeUrlHostname", () => {
  test("converts an internationalized hostname to ASCII", () => {
    expect(
      normalizeUrlHostname("https://münchen.example:8443/über?q=你好#résumé"),
    ).toBe("https://xn--mnchen-3ya.example:8443/über?q=你好#résumé");
  });

  test("preserves user info while converting the hostname", () => {
    expect(normalizeUrlHostname("https://user:pass@例え.テスト/path")).toBe(
      "https://user:pass@xn--r8jz45g.xn--zckzah/path",
    );
  });

  test("converts an internationalized hostname without a path", () => {
    expect(normalizeUrlHostname("https://münchen.example")).toBe(
      "https://xn--mnchen-3ya.example",
    );
  });

  test("converts hostnames with query or fragment delimiters", () => {
    expect(normalizeUrlHostname("https://münchen.example?q=über")).toBe(
      "https://xn--mnchen-3ya.example?q=über",
    );
    expect(normalizeUrlHostname("https://münchen.example#über")).toBe(
      "https://xn--mnchen-3ya.example#über",
    );
  });

  test("supports valid non-HTTP scheme characters", () => {
    expect(normalizeUrlHostname("git+ssh://例え.テスト/path")).toBe(
      "git+ssh://xn--r8jz45g.xn--zckzah/path",
    );
  });

  test("leaves bracketed IPv6 hosts unchanged", () => {
    expect(normalizeUrlHostname("https://[::1]/über")).toBe(
      "https://[::1]/über",
    );
  });

  test("leaves invalid ports and schemes unchanged", () => {
    expect(normalizeUrlHostname("https://münchen.example:abc/path")).toBe(
      "https://münchen.example:abc/path",
    );
    expect(normalizeUrlHostname("ht^tps://münchen.example/path")).toBe(
      "ht^tps://münchen.example/path",
    );
  });

  test("leaves hostnames rejected by domainToASCII unchanged", () => {
    expect(normalizeUrlHostname("https://\u200D.example/path")).toBe(
      "https://\u200D.example/path",
    );
  });

  test.each([
    ["an invalid scheme", "1https://münchen.example/path"],
    ["unicode outside the hostname", "https://example.com/über?q=你好#résumé"],
    ["a malformed URL", "not a url münchen.example"],
  ])("leaves %s unchanged", (_case, url) => {
    expect(normalizeUrlHostname(url)).toBe(url);
  });
});

describe("assertSupportedHttpUrl", () => {
  test.each(["http://example.com", "https://example.com"])(
    "accepts %s",
    (url) => {
      expect(() => assertSupportedHttpUrl(url)).not.toThrow();
    },
  );

  test.each(["file:///tmp/example", "ftp://example.com/file"])(
    "rejects unsupported protocol %s",
    (url) => {
      expect(() => assertSupportedHttpUrl(url)).toThrow(
        /protocol .* is not supported/,
      );
    },
  );

  test("rejects schemeless URLs", () => {
    expect(() => assertSupportedHttpUrl("example.com/path")).toThrow(
      /Invalid URL/,
    );
  });
});

describe("appendQueryString", () => {
  test.each([null, "invalid"])(
    "rejects non-object top-level query values: %j",
    (query) => {
      expect(() =>
        Reflect.apply(appendQueryString, undefined, [
          "https://example.com/path",
          query,
        ]),
      ).toThrow("Expected a plain object");
    },
  );

  test("accepts null-prototype top-level query objects", () => {
    const query: Record<string, unknown> = Object.create(null);
    query.value = "kept";

    expect(appendQueryString("https://example.com/path", query)).toBe(
      "https://example.com/path?value=kept",
    );
  });

  test("serializes nested objects and arrays with bracket notation", () => {
    const url = appendQueryString("https://example.com/path?existing=1", {
      filter: {
        status: "open",
        page: 2,
        flags: [true, false],
      },
      rows: [{ id: 1 }, { id: 2 }],
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.get("existing")).toBe("1");
    expect(parsed.searchParams.get("filter[status]")).toBe("open");
    expect(parsed.searchParams.get("filter[page]")).toBe("2");
    expect(parsed.searchParams.get("filter[flags][0]")).toBe("true");
    expect(parsed.searchParams.get("filter[flags][1]")).toBe("false");
    expect(parsed.searchParams.get("rows[0][id]")).toBe("1");
    expect(parsed.searchParams.get("rows[1][id]")).toBe("2");
    expect(url).not.toContain("%5Bobject+Object%5D");
  });

  test("replaces existing values for the serialized query key", () => {
    const url = appendQueryString(
      "https://example.com/path?filter=old&filter%5Bstatus%5D=stale&other=keep",
      {
        filter: { status: "open" },
      },
    );
    const parsed = new URL(url);

    expect(parsed.searchParams.has("filter")).toBe(false);
    expect(parsed.searchParams.getAll("filter[status]")).toStrictEqual([
      "open",
    ]);
    expect(parsed.searchParams.get("other")).toBe("keep");
  });

  test("serializes null, undefined, and dates intentionally", () => {
    const url = appendQueryString(
      "https://example.com/path?preserved=existing",
      {
        empty: null,
        omitted: undefined,
        preserved: undefined,
        when: new Date("2026-09-24T12:34:56.000Z"),
      },
    );
    const parsed = new URL(url);

    expect(parsed.searchParams.get("empty")).toBe("");
    expect(parsed.searchParams.has("omitted")).toBe(false);
    expect(parsed.searchParams.has("preserved")).toBe(false);
    expect(parsed.searchParams.get("when")).toBe("2026-09-24T12:34:56.000Z");
  });

  test("matches qs parse/merge/stringify and RFC3986 encoding", () => {
    const url = appendQueryString(
      "https://example.com/path?tag=one&tag=two&existing=a+b#section",
      {
        nested: {
          value: "hello world",
          punctuation: "!*'()",
        },
      },
    );

    expect(url).toBe(
      "https://example.com/path?tag%5B0%5D=one&tag%5B1%5D=two&existing=a%20b&nested%5Bvalue%5D=hello%20world&nested%5Bpunctuation%5D=%21%2A%27%28%29#section",
    );
  });

  test("compacts parsed sparse arrays and keeps indexes above the qs array limit as object keys", () => {
    const url = appendQueryString(
      "https://example.com/path?a%5B1%5D=b&a%5B15%5D=c&large%5B100%5D=x&mixed%5B0%5D=first&mixed%5Bname%5D=second",
      { other: "value" },
    );

    expect(url).toBe(
      "https://example.com/path?a%5B0%5D=b&a%5B1%5D=c&large%5B100%5D=x&mixed%5B0%5D=first&mixed%5Bname%5D=second&other=value",
    );
  });

  test("parses bracket arrays and preserves fragments without an existing query", () => {
    expect(
      appendQueryString(
        "https://example.com/path?items%5B%5D=one&items%5B%5D=two",
        { added: "three" },
      ),
    ).toBe(
      "https://example.com/path?items%5B0%5D=one&items%5B1%5D=two&added=three",
    );

    expect(
      appendQueryString("https://example.com/path#fragment", { value: "x" }),
    ).toBe("https://example.com/path?value=x#fragment");
  });

  test("uses qs-compatible depth, parameter, and malformed-escape handling", () => {
    const parameters = Array.from(
      { length: 1001 },
      (_, index) => `p${index}=v${index}`,
    ).join("&");
    const url = appendQueryString(
      `https://example.com/path?deep%5Ba%5D%5Bb%5D%5Bc%5D%5Bd%5D%5Be%5D%5Bf%5D=value&bad=%E0%A4%A&${parameters}`,
      {},
    );

    expect(url).toContain(
      "deep%5Ba%5D%5Bb%5D%5Bc%5D%5Bd%5D%5Be%5D%5B%5Bf%5D%5D=value",
    );
    expect(url).toContain("bad=%25E0%25A4%25A");
    expect(url).toContain("p997=v997");
    expect(url).not.toContain("p998=v998");
    expect(url).not.toContain("p1000=v1000");
  });

  test("matches qs conflict merging for mixed scalar, array, and object notation", () => {
    const url = appendQueryString(
      "https://example.com/path?array%5B0%5D=first&array=second&scalar=old&scalar%5Bnested%5D=new&object%5Bkey%5D=value&object=extra&empty%5Bkey%5D=value&empty=",
      {},
    );

    expect(url).toBe(
      "https://example.com/path?array%5B0%5D=first&array%5B1%5D=second&scalar%5B0%5D=old&scalar%5B1%5D%5Bnested%5D=new&object%5B0%5D%5Bkey%5D=value&object%5B1%5D=extra&empty%5Bkey%5D=value",
    );
  });

  test("supports bracket-leading keys, bare values, and malformed bracket tails", () => {
    const url = appendQueryString(
      "https://example.com/path?%5Broot%5D=value&flag&broken%5B=tail",
      {},
    );

    expect(url).toBe(
      "https://example.com/path?root=value&flag=&broken%5B%5B%5D=tail",
    );
  });

  test("covers empty, protected, and partially malformed parsed query keys", () => {
    const url = appendQueryString(
      "https://example.com/path?=ignored&broken%5Binner%5D%5B=tail&safe%5Bconstructor%5D=bad&safe%5Bvalue%5D=kept",
      {},
    );

    expect(url).toBe(
      "https://example.com/path?broken%5Binner%5D%5B%5B%5D=tail&safe%5Bvalue%5D=kept",
    );
  });

  test("covers scalar and same-index array merge conflicts", () => {
    const url = appendQueryString(
      "https://example.com/path?%5Balias%5D=first&alias=second&items%5B0%5D=first&items%5B%5D=second&objects%5B0%5D%5Bleft%5D=one&objects%5B0%5D%5Bright%5D=two",
      {},
    );

    expect(url).toBe(
      "https://example.com/path?alias%5B0%5D=first&alias%5B1%5D=second&items%5B0%5D=first&items%5B1%5D=second&objects%5B0%5D%5Bleft%5D=one&objects%5B0%5D%5Bright%5D=two",
    );
  });

  test("does not revive prototype keys from an existing query string", () => {
    const url = appendQueryString(
      "https://example.com/path?constructor=bad&__proto__%5Bpolluted%5D=yes&safe=value",
      { added: "ok" },
    );

    expect(url).toBe("https://example.com/path?safe=value&added=ok");
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  test("skips nested undefined values and supports bigint values", () => {
    const nullPrototype: Record<string, unknown> = Object.create(null);
    nullPrototype.value = "kept";

    const url = appendQueryString("https://example.com/path", {
      filter: { omitted: undefined, included: "yes" },
      count: 42n,
      buffer: Buffer.from("buffer value"),
      nullPrototype,
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.has("filter[omitted]")).toBe(false);
    expect(parsed.searchParams.get("filter[included]")).toBe("yes");
    expect(parsed.searchParams.get("count")).toBe("42");
    expect(parsed.searchParams.get("buffer")).toBe("buffer value");
    expect(parsed.searchParams.get("nullPrototype[value]")).toBe("kept");
  });
});
