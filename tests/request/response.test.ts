import { describe, expect, test } from "vitest";
import { RequestError } from "#/errors";
import request from "#/index";
import { FRAMING_SERVER_URL, SERVER_URL } from "#tests/app/config";
import { wrapperRequest } from "#tests/request/helpers";

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

describe("Response framing", () => {
  test("normalizes identical duplicate content-length fields", () => {
    const res = request(
      "GET",
      `${FRAMING_SERVER_URL}/content-length/identical`,
    );

    expect(res.headers["content-length"]).toBe("5");
    expect(res.body.toString()).toBe("hello");
  });

  test("rejects conflicting content-length fields", () => {
    expect(() =>
      request("GET", `${FRAMING_SERVER_URL}/content-length/conflicting`),
    ).toThrowError(
      new RequestError(
        "ERR_REQUEST_FAILED",
        "Request failed: Invalid response framing: conflicting Content-Length values",
      ),
    );
  });

  test("rejects content-length combined with transfer-encoding", () => {
    expect(() =>
      request("GET", `${FRAMING_SERVER_URL}/content-length/transfer-encoding`),
    ).toThrowError(
      new RequestError(
        "ERR_REQUEST_FAILED",
        "Request failed: Invalid response framing: Content-Length cannot be combined with Transfer-Encoding",
      ),
    );
  });
});

describe("Response buffering", () => {
  test("large response assembled across multiple chunks", () => {
    const res = request("GET", `${SERVER_URL}/large/response`);
    expect(res.getBody()).toHaveLength(512 * 1024);
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
