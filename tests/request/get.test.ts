import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "../app/config";
import { wrapperRequest } from "./helpers";

describe("GET requests", () => {
  test("GET request with no options", () => {
    const res = wrapperRequest("GET", SERVER_URL);
    expect(res).toMatchObject({
      code: 200,
      json: { message: "Hello, world!" },
    });
  });

  test("accepts URL objects", () => {
    const res = wrapperRequest("GET", new URL(SERVER_URL).href);
    const direct = request("GET", new URL(SERVER_URL));
    expect(res.code).toBe(200);
    expect(direct.getJSON()).toStrictEqual({ message: "Hello, world!" });
  });

  test("normalizes lowercase methods", () => {
    const res = wrapperRequest("get", SERVER_URL);
    expect(res).toMatchObject({
      code: 200,
      json: { message: "Hello, world!" },
    });
  });

  test("GET request with query string", () => {
    const value = "Hello, world!";
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test("GET request url returned correctly parsed", () => {
    const value = "comp1531";
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res.rawResponse.url).toStrictEqual(
      `${SERVER_URL}/get?value=comp1531`,
    );
  });

  test("GET request with query string, error 400", () => {
    const value = "echo";
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({
      code: 400,
      json: { error: "Cannot echo 'echo'!" },
    });
  });

  test("GET request with empty array", () => {
    const value: string[] = [];
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: {} });
  });

  test("GET request with non-empty array", () => {
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, {
      qs: { value: [1, 2, 3] },
    });
    const finalUrl = new URL(res.rawResponse.url);
    expect(finalUrl.searchParams.get("value[0]")).toStrictEqual("1");
    expect(finalUrl.searchParams.get("value[1]")).toStrictEqual("2");
    expect(finalUrl.searchParams.get("value[2]")).toStrictEqual("3");
  });

  test("GET request with undefined value", () => {
    const value = undefined;
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: {} });
  });

  test("GET request with empty string", () => {
    const value = "";
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: "" } });
  });

  test("GET request with null value", () => {
    const value = null;
    const res = wrapperRequest("GET", `${SERVER_URL}/get`, { qs: { value } });
    expect(res).toMatchObject({ code: 200, json: { value: "" } });
  });
});
