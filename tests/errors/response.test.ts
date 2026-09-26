import { describe, expect, test } from "vitest";
import { ResponseError } from "#/errors";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

describe("response errors", () => {
  test("getBody() exposes the 401 response", () => {
    const res = request("DELETE", `${SERVER_URL}/delete`, {
      headers: { value: "header" },
    });

    expect(res.statusCode).toBe(401);
    expect(() => res.getBody()).toThrow(ResponseError);

    try {
      res.getBody();
    } catch (error) {
      expect(error).toBeInstanceOf(ResponseError);
      expect(error).toMatchObject({
        statusCode: 401,
        headers: res.headers,
        body: res.body,
      });
    }
  });

  test("getBody() throws for a 404 response", () => {
    const res = request("DELETE", `${SERVER_URL}/unknown`);
    expect(res.statusCode).toBe(404);
    expect(() => res.getBody()).toThrow(ResponseError);
  });
});
