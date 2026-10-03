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

  test("preserves a single valid content-length value", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Content-Length: 005",
      "",
    ]);

    expect(headers["content-length"]).toBe("005");
  });

  test.each([
    ["identical repeated fields", ["Content-Length: 5", "Content-Length: 5"]],
    ["conflicting repeated fields", ["Content-Length: 5", "Content-Length: 6"]],
    ["identical comma-separated values", ["Content-Length: 5, 5"]],
    ["conflicting comma-separated values", ["Content-Length: 5, 6"]],
  ])("rejects multiple content-length values in %s", (_description, values) => {
    expect(() =>
      parseResponseHeaders(["HTTP/1.1 200 OK", ...values, ""]),
    ).toThrowError(
      new RequestError(
        "ERR_REQUEST_FAILED",
        "Request failed: Invalid response framing: multiple Content-Length values are not allowed",
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

  test("rejects invalid framing from an informational response block", () => {
    expect(() =>
      parseResponseHeaders([
        "HTTP/1.1 100 Continue",
        "Content-Length: 1",
        "Content-Length: 2",
        "",
        "HTTP/1.1 200 OK",
        "Content-Length: 5",
        "",
      ]),
    ).toThrowError(
      new RequestError(
        "ERR_REQUEST_FAILED",
        "Request failed: Invalid response framing: multiple Content-Length values are not allowed",
      ),
    );
  });

  test("parses header lines without a status line", () => {
    const headers = parseResponseHeaders(["X-Test: value"]);
    expect(headers["x-test"]).toStrictEqual("value");
  });

  test("separates detached lines without a status line", () => {
    const headers = parseResponseHeaders([
      "X-Test: value",
      "",
      "X-Trailer: trailer",
      "",
    ]);

    expect(headers["x-test"]).toBe("value");
    expect(headers["x-trailer"]).toBeUndefined();
  });

  test("keeps header values containing colons", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "Location: https://example.com:8443/path",
      "",
    ]);
    expect(headers.location).toStrictEqual("https://example.com:8443/path");
  });

  test("trims optional whitespace around response header values", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "X-Test:\t value \t ",
      "",
    ]);

    expect(headers["x-test"]).toBe("value");
  });

  test.each([
    ["invalid header names", "Bad Header: value"],
    ["whitespace before the colon", "X-Test : value"],
    ["invalid header value characters", "X-Test: bad\u0001value"],
  ])("rejects %s", (_description, header) => {
    expect(() => parseResponseHeaders(["HTTP/1.1 200 OK", header, ""])).toThrow(
      RequestError,
    );
  });

  test("unfolds obsolete response header lines", () => {
    const headers = parseResponseHeaders([
      "HTTP/1.1 200 OK",
      "X-Folded: first",
      " second",
      "\tthird",
      "",
    ]);

    expect(headers["x-folded"]).toBe("first second third");
  });

  test("rejects folded response lines without a preceding field", () => {
    expect(() =>
      parseResponseHeaders(["HTTP/1.1 200 OK", " folded", ""]),
    ).toThrow(RequestError);
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

  test("rejects malformed response trailers", () => {
    expect(() =>
      parseResponseHeaders([
        "HTTP/1.1 200 OK",
        "Transfer-Encoding: chunked",
        "",
        "Bad Header: value",
        "",
      ]),
    ).toThrow(RequestError);
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

  test.each([
    ["401 Unauthorized", 'WWW-Authenticate: Basic realm="test"'],
    [
      "407 Proxy Authentication Required",
      'Proxy-Authenticate: Basic realm="test"',
    ],
  ])(
    "uses only the final header block after an authentication challenge: %s",
    (challengeStatus, challengeHeader) => {
      const headers = parseResponseHeaders([
        `HTTP/1.1 ${challengeStatus}`,
        challengeHeader,
        "X-Challenge: first",
        "",
        "HTTP/1.1 200 OK",
        "X-Final: second",
        "",
      ]);

      expect(headers["x-challenge"]).toBeUndefined();
      expect(headers["x-final"]).toBe("second");
    },
  );

  test("serializes ordinary arrays as repeated lines and empty values", () => {
    expect(
      serializeRequestHeaders({
        "x-list": ["first", "", "second"],
        "x-empty": "",
      }),
    ).toStrictEqual(["x-list: first", "x-list;", "x-list: second", "x-empty;"]);
  });

  test("joins Cookie arrays with semicolons like Node", () => {
    expect(
      serializeRequestHeaders({
        Cookie: ["session=abc", "theme=dark"],
      }),
    ).toStrictEqual(["Cookie: session=abc; theme=dark"]);
    expect(serializeRequestHeaders({ Cookie: [] })).toStrictEqual([]);
  });

  test("rejects Host arrays like Node", () => {
    const error = captureError(() =>
      serializeRequestHeaders({ Host: ["example.com", "other.example"] }),
    );

    expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
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

  test.each([
    "HTTP/ 200 OK",
    "HTTP/1x 200 OK",
    "HTTP/... 200 OK",
    "HTTP/1.1 A00 Invalid",
    "HTTP/1.1 2A0 Invalid",
    "HTTP/1.1 20A Invalid",
    "HTTP/1.1 200X Invalid",
  ])("rejects malformed HTTP status-like lines: %s", (statusLine) => {
    expect(() =>
      parseResponseHeaders([
        "HTTP/1.1 103 Early Hints",
        "Link: </style.css>; rel=preload",
        "",
        statusLine,
        "X-Test: value",
      ]),
    ).toThrow(RequestError);
  });

  test("rejects a new status line before the previous block terminator", () => {
    expect(() =>
      parseResponseHeaders([
        "HTTP/1.1 103 Early Hints",
        "Link: </style.css>; rel=preload",
        "HTTP/1.1 200 OK",
        "X-Test: value",
        "",
      ]),
    ).toThrow(RequestError);
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

describe("native response request boundaries", () => {
  const probe = ["HTTP/1.1 200 OK", "X-Probe: first", "Content-Length: 11", ""];
  const final = [
    "HTTP/1.1 200 OK",
    "X-Final: second",
    "Content-Length: 11",
    "",
  ];
  const offsets = [0, probe.length];

  test("allows a real new request after a successful probe", () => {
    const headers = parseResponseHeaders([...probe, ...final], offsets);
    expect(headers["x-probe"]).toBeUndefined();
    expect(headers["x-final"]).toBe("second");
  });

  test.each([{ boundaries: undefined }, { boundaries: [0] }])(
    "rejects an unproven second success with offsets $boundaries",
    ({ boundaries }) => {
      expect(() =>
        parseResponseHeaders([...probe, ...final], boundaries),
      ).toThrow(RequestError);
    },
  );

  test("allows informational responses within the new request", () => {
    const hints = ["HTTP/1.1 103 Early Hints", "Link: </style.css>", ""];
    const headers = parseResponseHeaders(
      [...probe, ...hints, ...final],
      offsets,
    );
    expect(headers["x-final"]).toBe("second");
    expect(headers.link).toBeUndefined();
  });

  test("does not expose valid trailers as final headers", () => {
    const headers = parseResponseHeaders(
      [...probe, ...final, "X-Trailer: ignored", ""],
      offsets,
    );
    expect(headers["x-final"]).toBe("second");
    expect(headers["x-trailer"]).toBeUndefined();
  });

  test.each([
    [["HTTP/1.1 200 Forged", "X-Forged: trailer", ""]],
    [["Bad Trailer"]],
    [["X-Trailer: injected\r\nHeader: value"]],
  ])("still validates detached trailer lines %j", (trailers) => {
    expect(() =>
      parseResponseHeaders([...probe, ...final, ...trailers], offsets),
    ).toThrow(RequestError);
  });

  test.each([
    [["Content-Length: 1", "Content-Length: 2"]],
    [["Content-Length: 1", "Transfer-Encoding: chunked"]],
    [["Bad Header: value"]],
  ])("still validates preceding response headers %j", (invalid) => {
    const previous = ["HTTP/1.1 200 OK", ...invalid, ""];
    expect(() =>
      parseResponseHeaders([...previous, ...final], [0, previous.length]),
    ).toThrow(RequestError);
  });

  test("does not let metadata terminate an unfinished header block", () => {
    expect(() =>
      parseResponseHeaders(
        ["HTTP/1.1 200 OK", "X-Probe: first", ...final],
        [0, 2],
      ),
    ).toThrow(RequestError);
  });

  test.each([
    "200 OK",
    "401 Unauthorized",
    "407 Proxy Authentication Required",
    "302 Found",
  ])(
    "rejects forged later responses after terminal %s when metadata is available",
    (status) => {
      expect(() =>
        parseResponseHeaders(
          [`HTTP/1.1 ${status}`, "X-Terminal: first", "", ...final],
          [0],
        ),
      ).toThrow(RequestError);
    },
  );

  test("accepts a native authentication retry boundary", () => {
    const challenge = [
      "HTTP/1.1 401 Unauthorized",
      'WWW-Authenticate: Basic realm="test"',
      "",
    ];
    const headers = parseResponseHeaders(
      [...challenge, ...final],
      [0, challenge.length],
    );
    expect(headers["x-final"]).toBe("second");
    expect(headers["www-authenticate"]).toBeUndefined();
  });
});
