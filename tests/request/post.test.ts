import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "../app/config";
import { wrapperRequest } from "./helpers";

describe("POST Requests", () => {
  test.each([false, 0, "", null])("POST request with falsy JSON %j", (json) => {
    const res = request("POST", `${SERVER_URL}/json/echo`, { json });
    expect(res.getJSON()).toStrictEqual(json);
  });

  test("JSON takes precedence over body when JSON is falsy", () => {
    const res = request("POST", `${SERVER_URL}/json/echo`, {
      json: false,
      body: JSON.stringify("body"),
    });
    expect(res.getJSON()).toStrictEqual(false);
  });

  test("POST request with array of numbers", () => {
    const value = [1, 2, 3];
    const res = wrapperRequest("POST", `${SERVER_URL}/post`, {
      json: { value },
    });
    expect(res).toMatchObject({ code: 200, json: { value: [1, 2, 3] } });
  });

  test("POST request with error 400", () => {
    const value = "post";
    const res = wrapperRequest("POST", `${SERVER_URL}/post`, {
      json: { value },
    });
    expect(res).toMatchObject({
      code: 400,
      json: { error: "Cannot post 'post'!" },
    });
  });
});
