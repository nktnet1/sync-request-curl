import { describe, expect, test } from "vitest";
import request, { type HttpVerb } from "../src";
import { SERVER_URL } from "./app/config";

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
		{ method: "GET", route: "/get", key: "qs" },
		{ method: "POST", route: "/post", key: "json" },
	])("Method=$method, route=$route, key=$key", ({ method, route, key }) => {
		const res = request(method as HttpVerb, `${SERVER_URL + route}`, {
			[key]: { value: emoji },
		});
		expect(JSON.parse(res.body.toString())).toStrictEqual({ value: emoji });
	});
});
