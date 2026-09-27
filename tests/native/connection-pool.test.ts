import { describe, expect, test } from "vitest";
import native from "#/native/index";

describe("native connection pools", () => {
  test("creates and releases a reusable connection pool", () => {
    const poolId = native.createConnectionPool(2);

    expect(poolId).toBeGreaterThan(0);
    expect(() => native.releaseConnectionPool(poolId)).not.toThrow();
  });
});
