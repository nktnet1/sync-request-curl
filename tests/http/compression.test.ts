import { deflateSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { RequestError } from "#/errors";
import { decompressResponseBody } from "#/http/compression";

describe("response decompression", () => {
  test("decodes stacked supported content encodings in reverse order", () => {
    const original = Buffer.from("stacked response");
    const encoded = deflateSync(gzipSync(original));
    const headers = {
      "content-encoding": "gzip, deflate",
      "content-length": String(encoded.length),
    };

    expect(decompressResponseBody(encoded, headers, true)).toStrictEqual(
      original,
    );
    expect(headers["content-encoding"]).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
  });

  test("decodes content encoding header arrays", () => {
    const original = Buffer.from("array encoding response");
    const encoded = gzipSync(original);
    const headers = {
      "content-encoding": ["gzip"],
      "content-length": String(encoded.length),
    };

    expect(decompressResponseBody(encoded, headers, true)).toStrictEqual(
      original,
    );
    expect(headers["content-encoding"]).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
  });

  test("leaves unsupported content encodings untouched", () => {
    const body = Buffer.from("opaque response");
    const headers = {
      "content-encoding": "br",
      "content-length": String(body.length),
    };

    expect(decompressResponseBody(body, headers, true)).toBe(body);
    expect(headers["content-encoding"]).toBe("br");
    expect(headers["content-length"]).toBe(String(body.length));
  });

  test("retains content encoding when decompression is disabled", () => {
    const body = gzipSync(Buffer.from("compressed response"));
    const headers = {
      "content-encoding": "gzip",
      "content-length": String(body.length),
    };

    expect(decompressResponseBody(body, headers, false)).toBe(body);
    expect(headers["content-encoding"]).toBe("gzip");
    expect(headers["content-length"]).toBe(String(body.length));
  });

  test("wraps invalid compressed data without mutating response headers", () => {
    const body = Buffer.from("not gzip");
    const headers = {
      "content-encoding": "gzip",
      "content-length": String(body.length),
    };

    expect(() => decompressResponseBody(body, headers, true)).toThrow(
      RequestError,
    );
    expect(headers["content-encoding"]).toBe("gzip");
    expect(headers["content-length"]).toBe(String(body.length));
  });
});
