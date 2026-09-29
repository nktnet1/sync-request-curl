import { describe, expect, test } from "vitest";
import native from "#/native/index";

describe("native connection pools", () => {
  test("creates and releases a reusable connection pool", () => {
    const poolId = native.createConnectionPool(2);

    expect(poolId).toBeGreaterThan(0);
    expect(() => native.releaseConnectionPool(poolId)).not.toThrow();
  });
});

test("preserves multi-interface transport errors", () => {
  const poolId = native.createConnectionPool(1);
  try {
    const response = native.request({
      method: "GET",
      url: "unsupported-scheme://example.test",
      headers: [],
      timeout: 1000,
      overallTimeout: 0,
      socketTimeout: 1000,
      noBody: false,
      connectionPoolId: poolId,
    });
    expect(response.transportCode).toBe(1);
  } finally {
    native.releaseConnectionPool(poolId);
  }
});
