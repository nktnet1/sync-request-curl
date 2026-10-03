import { describe, expect, test } from "vitest";
import request from "#/index";
import { rate, rateEndpoint } from "./rate-limit-regressions.helpers";

describe("transfer limits and inactivity", () => {
  test("still times out a silent server after a completed upload", () => {
    const start = performance.now();
    expect(() =>
      request("POST", `${rateEndpoint}/upload?stall=1`, {
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
      request("POST", `${rateEndpoint}/upload?stall=1`, {
        body: Buffer.alloc(32 * 1024, "x"),
        maxUploadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 300,
      }),
    ).toThrow(expect.objectContaining({ code: "ETIMEDOUT" }));
  });

  test("retains an overall deadline during local throttling", () => {
    expect(() =>
      request("GET", `${rateEndpoint}/download`, {
        maxDownloadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 300,
      }),
    ).toThrow(expect.objectContaining({ code: "ETIMEDOUT" }));
  });
});
