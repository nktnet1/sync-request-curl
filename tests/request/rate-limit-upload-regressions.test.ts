import { describe, expect, test } from "vitest";
import request from "#/index";
import { bytes, rate, rateEndpoint } from "./rate-limit-regressions.helpers";

describe("transfer limits and inactivity", () => {
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

  // Aligned payloads can leave only a tiny final chunk on some libcurl builds,
  // hiding premature allowance resets. Exercise substantial final bursts too.
  test.each([32 * 1024, 96 * 1024])(
    "preserves the final upload allowance for a %i-byte body",
    (uploadBytes) => {
      const response = request("POST", `${rateEndpoint}/upload`, {
        body: Buffer.alloc(uploadBytes, "x"),
        maxUploadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 5_000,
      });
      expect(response.getJSON()).toEqual({ bytes: uploadBytes });
    },
  );
});
