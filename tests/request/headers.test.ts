import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";
import { wrapperRequest } from "#tests/request/helpers";

describe("Headers", () => {
  test("DELETE request with headers, code 401", () => {
    const value = "header";
    const res = wrapperRequest("DELETE", `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res).toMatchObject({
      code: 401,
      json: { error: "Cannot header 'header'!" },
    });
  });

  test("DELETE request with headers, valid value", () => {
    const value = "abcdefghijklmnopqrstuvwxyz";
    const res = wrapperRequest("DELETE", `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test("DELETE request with headers, empty string", () => {
    const value = "";
    const res = wrapperRequest("DELETE", `${SERVER_URL}/delete`, {
      headers: { value },
    });
    expect(res).toMatchObject({ code: 200, json: { value } });
  });

  test("Returned headers has no upper case letters", () => {
    const res = wrapperRequest("DELETE", `${SERVER_URL}/delete`, {
      headers: { value: "example" },
    });
    for (const header in res.rawResponse.headers) {
      if (Object.hasOwn(res.rawResponse.headers, header)) {
        expect(header).toMatch(/^[^A-Z]*$/);
      }
    }
  });

  test("HEAD requests should not contain a body", () => {
    const res = request("HEAD", `${SERVER_URL}/get`);
    expect(res.body.toString()).toStrictEqual("");
  });
});

// ========================================================================= //

describe("Correctly set content-length", () => {
  test("No options", () => {
    const res = wrapperRequest("POST", `${SERVER_URL}/content/length`);
    expect(res).toMatchObject({ code: 200, json: { headerLength: 0 } });
  });

  test("JSON payload", () => {
    const json = { message: "hi", sender: "Tam" };
    const res = wrapperRequest("POST", `${SERVER_URL}/content/length`, {
      json,
    });
    expect(res).toMatchObject({ code: 200, json: { headerLength: 31 } });
  });

  test("Body payload", () => {
    const body = '{"message":"hi","sender":"Tam"}';
    const res = wrapperRequest("POST", `${SERVER_URL}/content/length`, {
      body,
    });
    expect(res).toMatchObject({ code: 200, json: { headerLength: 31 } });
  });
});

describe("Generated request headers", () => {
  test("JSON headers replace conflicting caller headers", () => {
    const json = { message: "hi" };
    const res = request("POST", `${SERVER_URL}/request/headers`, {
      json,
      headers: {
        "content-type": "text/plain",
        "Content-Length": "999",
      },
    });

    expect(res.getJSON()).toStrictEqual({
      contentType: "application/json",
      contentLength: String(Buffer.byteLength(JSON.stringify(json))),
      transferEncoding: null,
    });
  });

  test("body content-length replaces a conflicting caller value", () => {
    const body = "hello";
    const res = request("POST", `${SERVER_URL}/request/headers`, {
      body,
      headers: { "content-length": "999" },
    });

    expect(res.getJSON()).toMatchObject({
      contentLength: String(Buffer.byteLength(body)),
    });
  });

  test("empty requests replace a conflicting caller content-length", () => {
    const res = request("POST", `${SERVER_URL}/request/headers`, {
      headers: { "Content-Length": "999" },
    });

    expect(res.getJSON()).toMatchObject({ contentLength: "0" });
  });

  test("transfer-encoding suppresses generated content-length", () => {
    const res = request("POST", `${SERVER_URL}/request/headers`, {
      json: { message: "hi" },
      headers: {
        "Transfer-Encoding": "chunked",
        "Content-Length": "999",
      },
    });

    expect(res.getJSON()).toMatchObject({
      contentLength: null,
      transferEncoding: "chunked",
    });
  });
});
