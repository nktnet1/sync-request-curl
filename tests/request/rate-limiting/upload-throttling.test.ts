import { describe, expect, test } from "vitest";
import request from "#/index";
import { bytes, rate, rateEndpoint } from "./helpers";

describe("upload rate limiting", () => {
  test("allows deliberate upload pauses longer than socketTimeout", () => {
    const start = performance.now();
    const response = request("POST", `${rateEndpoint}/upload`, {
      body: Buffer.alloc(bytes, "x"),
      maxUploadSpeed: rate,
      socketTimeout: 200,
      overallTimeout: 5_000,
    });
    expect(response.getJSON()).toEqual({ bytes });
    expect(performance.now() - start).toBeGreaterThan(700);
  });
});
