import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "../app/config";
import { wrapperRequest } from "./helpers";

describe("res.getBody()", () => {
  test("Using getBody() with no encoding", () => {
    const res = wrapperRequest("GET", SERVER_URL);
    const body: Buffer = res.rawResponse.getBody();
    expect(body).toBeInstanceOf(Buffer);
  });

  test("Using getBody('utf-8')", () => {
    const res = wrapperRequest("GET", SERVER_URL);
    const body: string = res.rawResponse.getBody("utf-8");
    expect(typeof body).toBe("string");
  });
});

// ========================================================================= //

describe("Response buffering", () => {
  test("large response assembled across multiple chunks", () => {
    const res = request("GET", `${SERVER_URL}/large/response`);
    expect(res.getBody().length).toStrictEqual(512 * 1024);
    expect(res.getBody().equals(Buffer.alloc(512 * 1024, "x"))).toStrictEqual(
      true,
    );
  });
});

describe("v3.2.0 getJSON method", () => {
  test("Valid JSON body", () => {
    const value = {
      1: "one",
      two: 2,
      three: true,
      four: null,
      nested: {
        five: false,
        array: [{ key: "value" }, { key2: "value2" }],
      },
    };
    const res = request("POST", `${SERVER_URL}/post`, { json: { value } });
    const jsonBody = res.getJSON();
    expect(jsonBody).toStrictEqual({ value });
  });

  test("Invalid JSON body", () => {
    const res = request("POST", `${SERVER_URL}/text`);
    expect(() => res.getJSON()).toThrow(Error);
  });
});
