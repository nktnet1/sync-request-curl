import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

describe.each([
  "😂",
  "🥲",
  "👨‍🏫",
  "🫨",
  "👨‍👨‍👧‍👦",
  "❤️‍🔥",
  "🥲 - 🙃 - 😀 - 🥰",
  "こんにちは, नमस्ते, مرحبًا, 你好, Γειά σας, שלום, Привет, გამარჯობა",
])("Unicode characters: %s", (emoji) => {
  test.each([
    { method: "GET", route: "/get", key: "qs" } as const,
    { method: "POST", route: "/post", key: "json" } as const,
  ])("Method=$method, route=$route, key=$key", ({ method, route, key }) => {
    const res = request(method, `${SERVER_URL + route}`, {
      [key]: { value: emoji },
    });
    expect(JSON.parse(res.body.toString())).toStrictEqual({ value: emoji });
  });
});
