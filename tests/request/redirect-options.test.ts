import { describe, expect, test } from "vitest";
import { prepareRequest } from "#/request/prepare";
import { getRedirectOptions } from "#/request/redirects";

const headers = {
  "Content-Length": "7",
  "Content-Type": "application/json",
  "Content-Encoding": "gzip",
  "Content-Language": "en",
  "Content-Location": "/old",
  Digest: "old",
  "Content-Digest": "old",
  "Repr-Digest": "old",
  "Last-Modified": "yesterday",
  Expect: "100-continue",
  Trailer: "Digest",
  "X-Trace": "keep",
};

describe("redirect payload metadata", () => {
  test("removes allow-listed payload fields when the method changes", () => {
    const options = getRedirectOptions(
      {
        body: "payload",
        headers,
        allowRedirectHeaders: Object.keys(headers),
      },
      true,
    );
    expect(options.body).toBeUndefined();
    expect(options.headers).toEqual({ "X-Trace": "keep" });
    expect(
      prepareRequest("https://example.com/next", options, "GET").headers,
    ).not.toContain("Content-Length: 7");
    expect(headers["Content-Length"]).toBe("7");
  });

  test("removes transfer framing when dropping the payload", () => {
    expect(
      getRedirectOptions(
        {
          body: "payload",
          headers: { "Transfer-Encoding": "chunked" },
          allowRedirectHeaders: ["transfer-encoding"],
        },
        true,
      ).headers,
    ).toBeUndefined();
  });

  test("preserves allowed payload fields on method-preserving redirects", () => {
    const options = getRedirectOptions(
      {
        body: "payload",
        headers,
        allowRedirectHeaders: Object.keys(headers),
      },
      false,
    );
    expect(options.body).toBe("payload");
    expect(options.headers).toEqual(headers);
  });
});

describe("redirect authentication", () => {
  const auth = { username: "user", password: "secret" } as const;

  test("preserves high-level auth for same-origin redirects", () => {
    expect(getRedirectOptions({ auth }, false, true).auth).toEqual(auth);
  });

  test("drops high-level auth for cross-origin redirects", () => {
    expect(getRedirectOptions({ auth }, false, false).auth).toBeUndefined();
  });
});
