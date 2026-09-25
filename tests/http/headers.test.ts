import { describe, expect, test } from "vitest";
import {
  hasRequestHeader,
  parseRequestHeaderLine,
  parseResponseHeaders,
  serializeRequestHeaders,
} from "#/http/headers";

describe("parseResponseHeaders", () => {
  test("folds repeated response headers like Node", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Set-Cookie: session=abc; Path=/",
      "Set-Cookie: preferences=dark; Path=/",
      "Set-Cookie: locale=en; Path=/",
      "Cookie: theme=dark",
      "Cookie: session=abc",
      "X-Test: first",
      "X-Test: second",
      "X-Test: third",
      "Content-Type: text/plain",
      "Content-Type: application/json",
      "",
    ]);

    expect(headers["set-cookie"]).toStrictEqual([
      "session=abc; Path=/",
      "preferences=dark; Path=/",
      "locale=en; Path=/",
    ]);
    expect(headers.cookie).toBe("theme=dark; session=abc");
    expect(headers["x-test"]).toBe("first, second, third");
    expect(headers["content-type"]).toBe("text/plain");
  });

  test("represents a single set-cookie header as an array", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Set-Cookie: session=abc; Path=/",
    ]);

    expect(headers["set-cookie"]).toStrictEqual(["session=abc; Path=/"]);
  });

  test.for([
    "age",
    "authorization",
    "content-length",
    "content-type",
    "etag",
    "expires",
    "from",
    "host",
    "if-modified-since",
    "if-unmodified-since",
    "last-modified",
    "location",
    "max-forwards",
    "proxy-authorization",
    "referer",
    "retry-after",
    "server",
    "user-agent",
  ])("keeps the first repeated Node singleton header: %s", (name) => {
    const headers = parseResponseHeaders([`${name}: first`, `${name}: second`]);

    expect(headers[name]).toBe("first");
  });

  test("parses header lines without a status line", () => {
    const headers = parseResponseHeaders(["X-Test: value"]);
    expect(headers["x-test"]).toStrictEqual("value");
  });

  test("keeps header values containing colons", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Location: https://example.com:8443/path",
      "",
    ]);
    expect(headers.location).toStrictEqual("https://example.com:8443/path");
  });

  test("uses only the final HTTP response header block", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 301 Moved Permanently",
      "X-Redirect: first",
      "",
      "HTTP/2 200 OK",
      "X-Final: second",
      "",
    ]);

    expect(headers["x-redirect"]).toBeUndefined();
    expect(headers["x-final"]).toBe("second");
  });

  test("serializes arrays, empty values, and skips undefined headers", () => {
    expect(
      serializeRequestHeaders({
        "x-list": ["first", "second"],
        "x-empty": "",
        "x-omitted": undefined,
      }),
    ).toStrictEqual(["x-list: first", "x-list: second", "x-empty;"]);
  });

  test("parses request header line formats through the shared parser", () => {
    expect(parseRequestHeaderLine("X-Test: value; parameter")).toStrictEqual({
      name: "x-test",
      value: "value; parameter",
    });
    expect(parseRequestHeaderLine("X-Empty;")).toStrictEqual({
      name: "x-empty",
      value: "",
    });
    expect(parseRequestHeaderLine("malformed")).toBeUndefined();
  });

  test("recognizes header names across supported line formats", () => {
    expect(hasRequestHeader(["X-Plain"], "x-plain")).toBe(true);
    expect(hasRequestHeader(["X-Empty;"], "x-empty")).toBe(true);
    expect(hasRequestHeader(["X-Test: value; parameter"], "x-test")).toBe(true);
  });

  test("ignores malformed HTTP status-like lines", () => {
    const headers = parseResponseHeaders([
      "HTTP/ 200 OK",
      "HTTP/1x 200 OK",
      "HTTP/... 200 OK",
      "HTTP/1.1 A00 Invalid",
      "HTTP/1.1 2A0 Invalid",
      "HTTP/1.1 20A Invalid",
      "X-Test: value",
    ]);

    expect(headers["x-test"]).toBe("value");
  });

  test("accepts extra whitespace after an HTTP version", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1   200 OK",
      "X-Test: value",
    ]);

    expect(headers["x-test"]).toBe("value");
  });

  test("accepts tab and end-of-line status boundaries", () => {
    expect(
      parseResponseHeaders(["HTTP/1.1 200\tOK", "X-Tab: value"])["x-tab"],
    ).toBe("value");
    expect(
      parseResponseHeaders(["HTTP/1.1 200", "X-End: value"])["x-end"],
    ).toBe("value");
  });
});
