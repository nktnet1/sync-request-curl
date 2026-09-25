import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { SERVER_URL } from "../app/config";
import { wrapperRequest } from "./helpers";

describe("Sending a buffer", () => {
  const body = fs.readFileSync("./tests/data/length-165.dmp");
  test("Body buffer from file", () => {
    expect(Buffer.byteLength(body)).toStrictEqual(165);
    const res = wrapperRequest("POST", `${SERVER_URL}/content/length`, {
      body,
      headers: {
        "Content-Type": "application/timestamp-query",
      },
    });
    expect(res).toMatchObject({ code: 200, json: { serverBufferLength: 165 } });
  });

  test("Body buffer larger than the curl read buffer", () => {
    const largeBody = Buffer.alloc(256 * 1024, 1);
    const res = wrapperRequest("POST", `${SERVER_URL}/content/length`, {
      body: largeBody,
    });
    expect(res).toMatchObject({
      code: 200,
      json: { serverBufferLength: largeBody.length },
    });
  });
});

// ========================================================================= //

describe("Body (instead of JSON)", () => {
  test("PUT request code 403", () => {
    const value = { value: "put" };
    const res = wrapperRequest("PUT", `${SERVER_URL}/put`, {
      body: JSON.stringify(value),
      headers: { "content-type": "application/json" },
    });
    expect(res).toMatchObject({
      code: 403,
      json: { error: "Cannot put 'put'!" },
    });
  });

  test("PUT request using valid value in body", () => {
    const value = { value: "Hello, world!" };
    const res = wrapperRequest("PUT", `${SERVER_URL}/put`, {
      body: JSON.stringify(value),
      headers: { "Content-Type": "application/json" },
    });
    expect(res).toMatchObject({ code: 200, json: { value: value.value } });
  });

  test("PUT request empty json", () => {
    const res = wrapperRequest("PUT", `${SERVER_URL}/put`, { json: {} });
    expect(res).toMatchObject({ code: 200, json: {} });
  });
});
