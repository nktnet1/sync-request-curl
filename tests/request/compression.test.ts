import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

describe("response compression", () => {
  test.each(["gzip", "deflate"] as const)(
    "decompresses %s responses by default",
    (encoding) => {
      const response = request("GET", `${SERVER_URL}/compressed/${encoding}`);

      expect(response.headers["content-encoding"]).toBeUndefined();
      expect(response.headers["content-length"]).toBeUndefined();
      expect(response.getJSON()).toStrictEqual({
        acceptEncoding: "gzip, deflate",
        message: "Compressed response",
      });
    },
  );

  test("preserves a caller supplied accept-encoding header", () => {
    const response = request("GET", `${SERVER_URL}/compressed/gzip`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.getJSON()).toStrictEqual({
      acceptEncoding: "gzip",
      message: "Compressed response",
    });
  });

  test("gzip false disables negotiation and automatic decompression", () => {
    const response = request("GET", `${SERVER_URL}/compressed/gzip`, {
      gzip: false,
    });
    const decoded = JSON.parse(gunzipSync(response.body).toString("utf8"));

    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-length"]).toBe(
      String(response.body.length),
    );
    expect(decoded).toStrictEqual({
      acceptEncoding: null,
      message: "Compressed response",
    });
    expect(() => response.getJSON()).toThrow();
  });

  test("gzip false still preserves an explicit accept-encoding header", () => {
    const response = request("GET", `${SERVER_URL}/compressed/gzip`, {
      gzip: false,
      headers: { "Accept-Encoding": "gzip" },
    });
    const decoded = JSON.parse(gunzipSync(response.body).toString("utf8"));

    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["content-length"]).toBe(
      String(response.body.length),
    );
    expect(decoded).toStrictEqual({
      acceptEncoding: "gzip",
      message: "Compressed response",
    });
  });
});
