import { describe, expect, test } from "vitest";
import { RequestError } from "#/errors";
import {
  hasRequestHeader,
  parseRequestHeaderLine,
  parseResponseHeaders,
  serializeRequestHeaders,
} from "#/http/headers";

const captureError = (callback: () => void): NodeJS.ErrnoException => {
  try {
    callback();
  } catch (error) {
    return error as NodeJS.ErrnoException;
  }
  throw new Error("Expected callback to throw");
};

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

  test("normalizes identical repeated content-length fields", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Content-Length: 5",
      "Content-Length: 5",
      "",
    ]);

    expect(headers["content-length"]).toBe("5");
  });

  test("normalizes identical comma-separated content-length values", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Content-Length: 005, 5",
      "",
    ]);

    expect(headers["content-length"]).toBe("005");
  });

  test.each([
    ["repeated fields", ["Content-Length: 5", "Content-Length: 6"]],
    ["comma-separated values", ["Content-Length: 5, 6"]],
  ])("rejects conflicting content-length %s", (_description, values) => {
    expect(() =>
      parseResponseHeaders(["HTTP/1.1 200 OK", ...values, ""]),
    ).toThrowError(
      new RequestError(
        "ERR_REQUEST_FAILED",
        "Request failed: Invalid response framing: conflicting Content-Length values",
      ),
    );
  });

  test.each(["", "-1", "+1", "1x", "1 1", "1,,1"])(
    "rejects invalid content-length value %j",
    (value) => {
      expect(() =>
        parseResponseHeaders([
          "HTTP/1.1 200 OK",
          `Content-Length: ${value}`,
          "",
        ]),
      ).toThrow(RequestError);
    },
  );

  test("rejects content-length combined with transfer-encoding", () => {
    expect(() =>
      parseResponseHeaders([
        "HTTP/1.1 200 OK",
        "Content-Length: 5",
        "Transfer-Encoding: chunked",
        "",
      ]),
    ).toThrowError(
      new RequestError(
        "ERR_REQUEST_FAILED",
        "Request failed: Invalid response framing: Content-Length cannot be combined with Transfer-Encoding",
      ),
    );
  });

  test("ignores invalid framing from an intermediate response block", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 100 Continue",
      "Content-Length: 1",
      "Content-Length: 2",
      "",
      "HTTP/1.1 200 OK",
      "Content-Length: 5",
      "",
    ]);

    expect(headers["content-length"]).toBe("5");
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

  test("does not fold response trailers into the header section", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Transfer-Encoding: chunked",
      "Trailer: X-Checksum",
      "",
      "X-Checksum: abc123",
      "",
    ]);

    expect(headers.trailer).toBe("X-Checksum");
    expect(headers["x-checksum"]).toBeUndefined();
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

  test("serializes arrays and empty values", () => {
    expect(
      serializeRequestHeaders({
        "x-list": ["first", "second"],
        "x-empty": "",
      }),
    ).toStrictEqual(["x-list: first", "x-list: second", "x-empty;"]);
  });

  test("rejects invalid request header names like Node", () => {
    const error = captureError(() =>
      serializeRequestHeaders({ "Bad Header": "value" }),
    );

    expect(error.code).toBe("ERR_INVALID_HTTP_TOKEN");
  });

  test.each(["hello\r\nInjected: yes", "hello\nworld", "hello\0world"])(
    "rejects invalid request header values like Node: %j",
    (value) => {
      const error = captureError(() =>
        serializeRequestHeaders({ "X-Test": value }),
      );

      expect(error.code).toBe("ERR_INVALID_CHAR");
    },
  );

  test("validates every request header array item", () => {
    const error = captureError(() =>
      serializeRequestHeaders({ "X-Test": ["valid", "bad\r\nvalue"] }),
    );

    expect(error.code).toBe("ERR_INVALID_CHAR");
  });

  test("rejects undefined request header values like Node", () => {
    const error = captureError(() =>
      serializeRequestHeaders({ "X-Test": undefined }),
    );

    expect(error.code).toBe("ERR_HTTP_INVALID_HEADER_VALUE");
  });

  test("accepts valid HTTP token punctuation and horizontal tabs", () => {
    expect(
      serializeRequestHeaders({
        "!#$%&'*+-.^_`|~Token": "hello\tworld",
      }),
    ).toStrictEqual(["!#$%&'*+-.^_`|~Token: hello\tworld"]);
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
