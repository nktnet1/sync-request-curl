import { deflateSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { RequestError } from "#/errors";
import { decompressResponseBody } from "#/http/compression";

describe("response decompression", () => {
  test("decodes stacked supported content encodings in reverse order", () => {
    const original = Buffer.from("stacked response");
    const encoded = deflateSync(gzipSync(original));
    const headers = { "content-encoding": "gzip, deflate" };

    expect(decompressResponseBody(encoded, headers, true)).toStrictEqual(
      original,
    );
    expect(headers["content-encoding"]).toBeUndefined();
  });

  test("decodes content encoding header arrays", () => {
    const original = Buffer.from("array encoding response");
    const headers = { "content-encoding": ["gzip"] };

    expect(
      decompressResponseBody(gzipSync(original), headers, true),
    ).toStrictEqual(original);
    expect(headers["content-encoding"]).toBeUndefined();
  });

  test("leaves unsupported content encodings untouched", () => {
    const body = Buffer.from("opaque response");
    const headers = { "content-encoding": "br" };

    expect(decompressResponseBody(body, headers, true)).toBe(body);
    expect(headers["content-encoding"]).toBe("br");
  });

  test("retains content encoding when decompression is disabled", () => {
    const body = gzipSync(Buffer.from("compressed response"));
    const headers = { "content-encoding": "gzip" };

    expect(decompressResponseBody(body, headers, false)).toBe(body);
    expect(headers["content-encoding"]).toBe("gzip");
  });

  test("wraps invalid compressed data in RequestError", () => {
    expect(() =>
      decompressResponseBody(
        Buffer.from("not gzip"),
        { "content-encoding": "gzip" },
        true,
      ),
    ).toThrow(RequestError);
  });
});
