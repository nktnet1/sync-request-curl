import { describe, expect, test } from "vitest";
import {
  hasRequestHeader,
  parseResponseHeaders,
  serializeRequestHeaders,
} from "#/http/headers";

describe("parseResponseHeaders", () => {
  test("preserves repeated response headers", () => {
    const headers = parseResponseHeaders([
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
