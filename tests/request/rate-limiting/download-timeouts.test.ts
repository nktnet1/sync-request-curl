import { describe, expect, test } from "vitest";
import request from "#/index";
import { bytes, rate, rateEndpoint } from "./helpers";

describe("download rate-limit inactivity", () => {
  test("still times out a stalled transfer after its earned allowance expires", () => {
    const start = performance.now();
    expect(() =>
      request("GET", `${rateEndpoint}/stall`, {
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
      request("GET", `${rateEndpoint}/stall?headersOnly=1`, {
        maxDownloadSpeed: 1,
        maxUploadSpeed: 1,
        socketTimeout: 200,
        overallTimeout: 2_000,
      }),
    ).toThrow(expect.objectContaining({ code: 28 }));
    expect(performance.now() - start).toBeLessThan(1_500);
  });

  test("zero limits retain ordinary inactivity handling", () => {
    const response = request("GET", `${rateEndpoint}/download`, {
      maxDownloadSpeed: 0,
      maxUploadSpeed: 0,
      socketTimeout: 200,
      overallTimeout: 2_000,
    });
    expect(response.body).toHaveLength(bytes);
  });
});
