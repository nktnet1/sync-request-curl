import { describe, expect, test } from "vitest";
import request from "#/index";
import { bytes, rate, rateEndpoint } from "./helpers";

describe("download rate limiting", () => {
  test("allows deliberate download pauses longer than socketTimeout", () => {
    const start = performance.now();
    const response = request("GET", `${rateEndpoint}/download`, {
      maxDownloadSpeed: rate,
      socketTimeout: 200,
      overallTimeout: 5_000,
    });
    expect(response.body).toEqual(Buffer.alloc(bytes, "x"));
    expect(performance.now() - start).toBeGreaterThan(700);
  });
});
