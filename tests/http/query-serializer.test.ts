import { describe, expect, test } from "vitest";
import { encodeQueryComponent } from "#/http/query/components";
import { stringifyQuery } from "#/http/query/serializer";

describe("query value stringification", () => {
  test.each([
    ["string", "hello world", "hello world"],
    ["number", 12, "12"],
    ["bigint", 12n, "12"],
    ["boolean", false, "false"],
    ["symbol", Symbol("key"), "Symbol(key)"],
  ])(
    "stringifies a %s without treating it as an object",
    (_type, value, expected) => {
      expect(stringifyQuery({ value })).toBe(
        `value=${encodeQueryComponent(expected)}`,
      );
    },
  );

  test("stringifies functions using their source form", () => {
    const value = () => 42;
    expect(stringifyQuery({ value })).toBe(
      `value=${encodeQueryComponent(String(value))}`,
    );
  });

  test("handles dates, buffers, null, undefined and nested objects", () => {
    expect(
      stringifyQuery({
        date: new Date("2020-01-02T03:04:05.000Z"),
        bytes: Buffer.from("ok"),
        empty: null,
        omitted: undefined,
        nested: { item: "a" },
      }),
    ).toBe(
      "date=2020-01-02T03%3A04%3A05.000Z&bytes=ok&empty=&nested%5Bitem%5D=a",
    );
  });
});
