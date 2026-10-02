import { describe, expect, test } from "vitest";
import request from "#/index";
import { FRAMING_SERVER_URL } from "#tests/app/config";

const endpoint = `${FRAMING_SERVER_URL}/regressions/rate`;
const rate = 64 * 1024;
const bytes = 128 * 1024;

describe("transfer limits and inactivity", () => {
  test("allows deliberate download pauses longer than socketTimeout", () => {
    const start = performance.now();
    const response = request("GET", `${endpoint}/download`, {
      maxDownloadSpeed: rate,
      socketTimeout: 200,
      overallTimeout: 5_000,
    });
    expect(response.body).toEqual(Buffer.alloc(bytes, "x"));
    expect(performance.now() - start).toBeGreaterThan(700);
  });

  test("allows deliberate upload pauses longer than socketTimeout", () => {
    const start = performance.now();
    const response = request("POST", `${endpoint}/upload`, {
      body: Buffer.alloc(bytes, "x"),
      maxUploadSpeed: rate,
      socketTimeout: 200,
      overallTimeout: 5_000,
    });
    expect(response.getJSON()).toEqual({ bytes });
    expect(performance.now() - start).toBeGreaterThan(700);
  });

  // Aligned payloads can leave only a tiny final chunk on some libcurl builds,
  // hiding premature allowance resets. Exercise substantial final bursts too.
  test.each([32 * 1024, 96 * 1024])(
    "preserves the final upload allowance for a %i-byte body",
    (uploadBytes) => {
      const response = request("POST", `${endpoint}/upload`, {
        body: Buffer.alloc(uploadBytes, "x"),
        maxUploadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 5_000,
      });
      expect(response.getJSON()).toEqual({ bytes: uploadBytes });
    },
  );

  test("still times out a silent server after a completed upload", () => {
    const start = performance.now();
    expect(() =>
      request("POST", `${endpoint}/upload?stall=1`, {
        body: Buffer.alloc(32 * 1024, "x"),
        maxUploadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 2_500,
      }),
    ).toThrow(expect.objectContaining({ code: 28 }));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("retains an overall deadline after the final upload chunk", () => {
    expect(() =>
      request("POST", `${endpoint}/upload?stall=1`, {
        body: Buffer.alloc(32 * 1024, "x"),
        maxUploadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 300,
      }),
    ).toThrow(expect.objectContaining({ code: "ETIMEDOUT" }));
  });

  test("retains an overall deadline during local throttling", () => {
    expect(() =>
      request("GET", `${endpoint}/download`, {
        maxDownloadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 300,
      }),
    ).toThrow(expect.objectContaining({ code: "ETIMEDOUT" }));
  });

  test("still times out a stalled transfer after its earned allowance expires", () => {
    const start = performance.now();
    expect(() =>
      request("GET", `${endpoint}/stall`, {
        maxDownloadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 2_500,
      }),
    ).toThrow(expect.objectContaining({ code: 28 }));
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  test("does not grant throttle allowance just for receiving headers", () => {
    const start = performance.now();
    expect(() =>
      request("GET", `${endpoint}/stall?headersOnly=1`, {
        maxDownloadSpeed: 1,
        maxUploadSpeed: 1,
        socketTimeout: 200,
        overallTimeout: 2_000,
      }),
    ).toThrow(expect.objectContaining({ code: 28 }));
    expect(performance.now() - start).toBeLessThan(1_500);
  });

  test("zero limits retain ordinary inactivity handling", () => {
    const response = request("GET", `${endpoint}/download`, {
      maxDownloadSpeed: 0,
      maxUploadSpeed: 0,
      socketTimeout: 200,
      overallTimeout: 2_000,
    });
    expect(response.body).toHaveLength(bytes);
  });
});
