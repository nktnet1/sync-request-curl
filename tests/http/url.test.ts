import { describe, expect, test } from "vitest";
import { appendQueryString, normalizeUrlHostname } from "#/http/url";

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
    expect(parsed.searchParams.get("preserved")).toBe("existing");
    expect(parsed.searchParams.get("when")).toBe("2026-09-24T12:34:56.000Z");
  });

  test("skips nested undefined values and supports bigint values", () => {
    const nullPrototype: Record<string, unknown> = Object.create(null);
    nullPrototype.value = "kept";

    const url = appendQueryString("https://example.com/path", {
      filter: { omitted: undefined, included: "yes" },
      count: 42n,
      nullPrototype,
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.has("filter[omitted]")).toBe(false);
    expect(parsed.searchParams.get("filter[included]")).toBe("yes");
    expect(parsed.searchParams.get("count")).toBe("42");
    expect(parsed.searchParams.get("nullPrototype[value]")).toBe("kept");
  });

  test("rejects unsupported and circular query values", () => {
    expect(() =>
      appendQueryString("https://example.com/path", {
        callback: () => undefined,
      }),
    ).toThrow('Unsupported query-string value for "callback": function');

    expect(() =>
      appendQueryString("https://example.com/path", {
        map: new Map([["key", "value"]]),
      }),
    ).toThrow('Unsupported query-string object for "map"');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      appendQueryString("https://example.com/path", { circular }),
    ).toThrow(
      'Cannot serialize circular query-string value at "circular[self]"',
    );
  });
});
