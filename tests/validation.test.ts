import { URL } from "node:url";
import * as v from "valibot";
import { describe, expect, test } from "vitest";
import {
  httpVerbSchema,
  incomingHttpHeadersSchema,
  optionsSchema,
  requestUrlSchema,
} from "#/validation";

describe("runtime validation", () => {
  test("normalizes supported HTTP methods and rejects unsupported methods", () => {
    expect(v.parse(httpVerbSchema, "post")).toBe("POST");
    expect(v.safeParse(httpVerbSchema, "BREW").success).toBe(false);
  });

  test("accepts string and URL request targets", () => {
    expect(v.parse(requestUrlSchema, "https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(
      v.parse(requestUrlSchema, new URL("https://example.com/other")),
    ).toBe("https://example.com/other");
  });

  test("validates request options and header values", () => {
    expect(
      v.safeParse(optionsSchema, {
        headers: { "x-test": ["one", "two"] },
        timeout: 100,
        followRedirects: true,
      }).success,
    ).toBe(true);
    expect(v.safeParse(optionsSchema, { timeout: "fast" }).success).toBe(false);
    expect(
      v.safeParse(optionsSchema, { maxRedirects: Number.NaN }).success,
    ).toBe(false);
    expect(
      v.safeParse(incomingHttpHeadersSchema, { "x-invalid": 123 }).success,
    ).toBe(false);
  });
});
