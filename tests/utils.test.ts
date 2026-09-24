import { describe, expect, test } from "vitest";
import { normalizeUrlHostname, parseReturnedHeaders } from "../src/utils";

describe("parseReturnedHeaders", () => {
  test("preserves repeated response headers", () => {
    const headers = parseReturnedHeaders([
      "HTTP/1.1 200 OK",
      "Set-Cookie: session=abc; Path=/",
      "Set-Cookie: preferences=dark; Path=/",
      "Set-Cookie: locale=en; Path=/",
      "X-Test: first",
      "X-Test: second",
      "",
    ]);

    expect(headers["set-cookie"]).toStrictEqual([
      "session=abc; Path=/",
      "preferences=dark; Path=/",
      "locale=en; Path=/",
    ]);
    expect(headers["x-test"]).toStrictEqual(["first", "second"]);
  });

  test("parses header lines without a status line", () => {
    const headers = parseReturnedHeaders(["X-Test: value"]);

    expect(headers["x-test"]).toStrictEqual("value");
  });

  test("keeps header values containing colons", () => {
    const headers = parseReturnedHeaders([
      "HTTP/1.1 200 OK",
      "Location: https://example.com:8443/path",
      "",
    ]);

    expect(headers.location).toStrictEqual("https://example.com:8443/path");
  });
});

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

  test.each([
    ["an invalid scheme", "1https://münchen.example/path"],
    ["unicode outside the hostname", "https://example.com/über?q=你好#résumé"],
    ["a malformed URL", "not a url münchen.example"],
  ])("leaves %s unchanged", (_case, url) => {
    expect(normalizeUrlHostname(url)).toBe(url);
  });
});
