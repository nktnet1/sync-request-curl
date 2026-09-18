import { describe, expect, test } from "vitest";
import { parseReturnedHeaders } from "../src/utils";

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
