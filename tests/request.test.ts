import fs from "fs";
import path from "path";
import { describe, expect, test, vi } from "vitest";
import request, { type HttpVerb, type Options } from "../src";
import { SERVER_URL } from "./app/config";

// ========================================================================= //

const wrapperRequest = (method: HttpVerb, url: string, option?: Options) => {
  const rawResponse = request(method, url, option);
  let json: unknown;

  try {
    json = JSON.parse(rawResponse.body.toString());
  } catch (error: unknown) {
    json = {
      error: `Failed to parse JSON: ${
        error instanceof Error ? error.message : error
      }`,
    };
  }
  return {
    rawResponse,
    json,
    code: rawResponse.statusCode,
  };
};

// ========================================================================= //

describe("GET requests", () => {
  test("GET request with no options", () => {
    const res = wrapperRequest("GET", SERVER_URL);
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

// ========================================================================= //

describe("POST Requests", () => {
  test.each([false, 0, "", null])(
    "POST request with falsy JSON %j",
    (json) => {
      const res = request("POST", `${SERVER_URL}/json/echo`, { json });
      expect(res.getJSON()).toStrictEqual(json);
    },
  );

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

// ========================================================================= //

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

// ========================================================================= //

// https://github.com/nktnet1/sync-request-curl/issues/116
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

  test("External URL for buffer", () => {
    const res = request("POST", "https://acsk.privatbank.ua/services/tsp/", {
      headers: {
        "Content-Type": "application/timestamp-query",
      },
      body,
    });
    expect(res.statusCode).toStrictEqual(200);
  });
});

// ========================================================================= //

describe("Body (instead of JSON)", () => {
  test("PUT request code 401", () => {
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

// ========================================================================= //

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
    expect(res.body.length).toStrictEqual(512 * 1024);
    expect(res.body.equals(Buffer.alloc(512 * 1024, "x"))).toStrictEqual(true);
  });
});

// ========================================================================= //

describe("Redirects", () => {
  test("No redirect", () => {
    const res = wrapperRequest("GET", `${SERVER_URL}/redirect/source`, {
      followRedirects: false,
    });
    expect(res).toMatchObject({ code: 302 });
  });

  test("Explicit redirect", () => {
    const res = wrapperRequest("GET", `${SERVER_URL}/redirect/source`, {
      followRedirects: true,
    });
    expect(res).toMatchObject({
      code: 200,
      json: { message: "Redirect success!" },
    });
  });

  test("Implicit redirect (default)", () => {
    const res = wrapperRequest("GET", `${SERVER_URL}/redirect/source`);
    expect(res).toMatchObject({
      code: 200,
      json: { message: "Redirect success!" },
    });
  });

  test("Only final response headers are returned after redirects", () => {
    const res = request(
      "GET",
      `${SERVER_URL}/redirect/response-headers/source`,
    );
    expect(res.statusCode).toStrictEqual(200);
    expect(res.headers["x-final-response"]).toStrictEqual("final");
    expect(res.headers["x-intermediate-response"]).toBeUndefined();
  });

  test("Max redirect 2, causes error", () => {
    const wrap = () =>
      wrapperRequest("GET", `${SERVER_URL}/redirect/source`, {
        qs: { redirectNumber: 3 },
        headers: { "x-test": "value" },
        maxRedirects: 2,
      });
    expect(wrap).toThrow(Error);
  });

  test("Manual redirects use the remaining overall timeout", () => {
    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1001);

    try {
      expect(() =>
        request("GET", `${SERVER_URL}/redirect/source`, {
          headers: { "x-test": "value" },
          timeout: 1000,
        }),
      ).toThrow(Error);
    } finally {
      dateNow.mockRestore();
    }
  });

  test("Manual redirect handling returns a non-redirect response", () => {
    const res = wrapperRequest("GET", SERVER_URL, {
      headers: { "x-test": "value" },
    });
    expect(res).toMatchObject({
      code: 200,
      json: { message: "Hello, world!" },
    });
  });

  test("Final url returned not redirected", () => {
    const res = wrapperRequest("GET", `${SERVER_URL}/redirect/source`, {
      followRedirects: false,
    });
    expect(res.rawResponse.url).toStrictEqual(`${SERVER_URL}/redirect/source`);
  });

  test("Final url returned is the redirect version", () => {
    const res = wrapperRequest("GET", `${SERVER_URL}/redirect/source`);
    expect(res.rawResponse.url).toStrictEqual(
      `${SERVER_URL}/redirect/destination`,
    );
  });

  test("POST changes to GET after a 302 redirect", () => {
    const res = wrapperRequest("POST", `${SERVER_URL}/redirect/method/302`, {
      body: "payload",
      headers: { "x-test": "value" },
    });
    expect(res).toMatchObject({
      code: 200,
      json: { method: "GET" },
    });
  });

  test("PUT changes to GET after a 303 redirect", () => {
    const res = wrapperRequest("PUT", `${SERVER_URL}/redirect/method/303`, {
      body: "payload",
      headers: { "x-test": "value" },
    });
    expect(res).toMatchObject({
      code: 200,
      json: { method: "GET" },
    });
  });

  test("PUT remains PUT after a 307 redirect", () => {
    const res = wrapperRequest("PUT", `${SERVER_URL}/redirect/method/307`, {
      headers: { "x-test": "value" },
    });
    expect(res).toMatchObject({
      code: 200,
      json: { method: "PUT" },
    });
  });

  test("Same-origin redirect keeps custom headers", () => {
    const res = wrapperRequest(
      "GET",
      `${SERVER_URL}/redirect/headers/same-origin`,
      { headers: { "x-api-key": "secret" } },
    );
    expect(res).toMatchObject({
      code: 200,
      json: { apiKey: "secret" },
    });
  });

  test("Cross-origin redirect drops custom headers", () => {
    const res = wrapperRequest(
      "GET",
      `${SERVER_URL}/redirect/headers/cross-origin`,
      { headers: { "x-api-key": "secret" } },
    );
    expect(res).toMatchObject({
      code: 200,
      json: { apiKey: null },
    });
  });

  test.skip("External URL redirect - https://picsum.photos/200/300", () => {
    const redirectResponse = wrapperRequest(
      "GET",
      "https://picsum.photos/200/300",
    );
    expect(redirectResponse).toMatchObject({ code: 200 });
    const noRedirect = wrapperRequest("GET", "https://picsum.photos/200/300", {
      followRedirects: false,
    });
    expect(noRedirect).toMatchObject({ code: 302 });
  });
});

// ========================================================================= //

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

describe("v3.3.0 multipart/formdata", () => {
  test("Can upload one file", () => {
    const testFileLocation = "./tests/data/test-upload.txt";
    const res = request("POST", `${SERVER_URL}/upload`, {
      formData: [
        {
          file: testFileLocation,
          name: "1-test-file-upload",
          type: "text/plain",
        },
        {
          name: "2-test-contents",
          contents: "Example Content!",
        },
      ],
    });
    expect(res.statusCode).toStrictEqual(200);
    expect(res.getJSON()).toStrictEqual([
      {
        name: "1-test-file-upload",
        file: {
          name: path.basename(testFileLocation),
          size: fs.readFileSync(testFileLocation).length,
          type: "text/plain",
          lastModified: expect.any(Number),
        },
      },
      { name: "2-test-contents", content: "Example Content!" },
    ]);
  });
});
