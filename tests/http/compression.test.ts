import { deflateSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { RequestError } from "#/errors";
import { decompressResponseBody } from "#/http/compression";

describe("response decompression", () => {
  test("decodes stacked supported content encodings in reverse order", () => {
    const original = Buffer.from("stacked response");
    const encoded = deflateSync(gzipSync(original));

    expect(
      decompressResponseBody(
        encoded,
        { "content-encoding": "gzip, deflate" },
        true,
      ),
    ).toStrictEqual(original);
  });

  test("leaves unsupported content encodings untouched", () => {
    const body = Buffer.from("opaque response");

    expect(
      decompressResponseBody(body, { "content-encoding": "br" }, true),
    ).toBe(body);
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
