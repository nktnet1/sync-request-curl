import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

describe("HTTP method compatibility", () => {
  test("accepts extension methods and normalizes them case-insensitively", () => {
    const response = request(
      "propfind",
      `${SERVER_URL}/redirect/method/destination`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.getJSON()).toStrictEqual({ method: "PROPFIND" });
  });
});
