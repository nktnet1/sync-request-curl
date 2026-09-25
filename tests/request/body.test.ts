import fs from "node:fs";
import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";
import { wrapperRequest } from "#tests/request/helpers";

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

describe("HEAD request payloads", () => {
  test("sends an explicit Buffer body while suppressing the response body", () => {
    const body = Buffer.from([0x00, 0x7f, 0x80, 0xff]);
    const response = request("HEAD", `${SERVER_URL}/compat/head-payload`, {
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-body-hex"]).toBe(body.toString("hex"));
    expect(response.headers["x-request-body-length"]).toBe(String(body.length));
    expect(response.headers["content-length"]).toBe("1024");
    expect(response.body).toStrictEqual(Buffer.alloc(0));
  });

  test("sends JSON payloads", () => {
    const json = { message: "HEAD payload" };
    const body = JSON.stringify(json);
    const response = request("HEAD", `${SERVER_URL}/compat/head-payload`, {
      json,
    });

    expect(response.headers["x-request-body-hex"]).toBe(
      Buffer.from(body).toString("hex"),
    );
    expect(response.headers["x-request-content-type"]).toBe("application/json");
    expect(response.body).toStrictEqual(Buffer.alloc(0));
  });

  test("sends multipart form payloads", () => {
    const form = new request.FormData();
    form.append("message", "hello from HEAD");

    const response = request("HEAD", `${SERVER_URL}/compat/head-payload`, {
      form,
    });
    const body = Buffer.from(
      response.headers["x-request-body-hex"] as string,
      "hex",
    ).toString("utf8");

    expect(response.headers["x-request-content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(body).toContain('name="message"');
    expect(body).toContain("hello from HEAD");
    expect(response.body).toStrictEqual(Buffer.alloc(0));
  });
});
