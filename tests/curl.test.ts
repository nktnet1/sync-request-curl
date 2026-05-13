import { describe, expect, test } from "vitest";
import request, { type SetEasyOptionCallback } from "../src";
import { SERVER_URL } from "./app/config";

describe("Callback setEasyOptions headers override", () => {
	const setEasyOptions: SetEasyOptionCallback = (curl, options) => {
		curl.setOpt(options.HTTPHEADER, ["value: Tammy McTamtam"]);
	};

	test("Curl easy option set for headers", () => {
		const res = request("DELETE", `${SERVER_URL}/delete`, { setEasyOptions });
		expect(JSON.parse(res.body.toString())).toStrictEqual({
			value: "Tammy McTamtam",
		});
	});

	test("Curl easy option set, override headers", () => {
		const res = request("DELETE", `${SERVER_URL}/delete`, {
			headers: { value: "override me" },
			setEasyOptions,
		});
		expect(JSON.parse(res.body.toString())).toStrictEqual({
			value: "Tammy McTamtam",
		});
	});
});
