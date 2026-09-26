import { describe, expect, test } from "vitest";
import request from "#/index";
import { prepareRequest } from "#/request/prepare";
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
  test("JSON preserves caller content type and matching content-length", () => {
    const json = { message: "hi" };
    const length = Buffer.byteLength(JSON.stringify(json));
    const prepared = prepareRequest("https://example.com", {
      json,
      headers: {
        "content-type": "text/plain",
        "Content-Length": String(length),
      },
    });

    expect(prepared.headers).toEqual(
      expect.arrayContaining([
        "content-type: text/plain",
        `Content-Length: ${length}`,
      ]),
    );
  });

  test("rejects a JSON content-length that does not match the serialized body", () => {
    expect(() =>
      prepareRequest("https://example.com", {
        json: { message: "hi" },
        headers: { "Content-Length": "999" },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length does not match the request body length (16)",
    );
  });

  test("body content-length preserves a matching caller value", () => {
    const prepared = prepareRequest("https://example.com", {
      body: "hello",
      headers: { "content-length": "5" },
    });

    expect(prepared.headers).toContain("content-length: 5");
  });

  test("compares content-length using body bytes rather than string characters", () => {
    const prepared = prepareRequest("https://example.com", {
      body: "é",
      headers: { "Content-Length": "2" },
    });

    expect(prepared.headers).toContain("Content-Length: 2");
  });

  test("accepts a matching content-length with leading zeroes", () => {
    const prepared = prepareRequest("https://example.com", {
      body: "hello",
      headers: { "Content-Length": "005" },
    });

    expect(prepared.headers).toContain("Content-Length: 005");
  });

  test("rejects a body content-length that does not match the payload", () => {
    expect(() =>
      prepareRequest("https://example.com", {
        body: "hello",
        headers: { "content-length": "999" },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length does not match the request body length (5)",
    );
  });

  test.each(["", "-1", "5, 5", "5x"])(
    "rejects invalid outbound content-length %j",
    (contentLength) => {
      expect(() =>
        prepareRequest("https://example.com", {
          body: "hello",
          headers: { "Content-Length": contentLength },
        }),
      ).toThrow(
        "Request failed: Invalid request framing: invalid Content-Length",
      );
    },
  );

  test("rejects repeated outbound content-length fields", () => {
    expect(() =>
      prepareRequest("https://example.com", {
        body: "hello",
        headers: { "Content-Length": ["5", "5"] },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: multiple Content-Length fields are not allowed",
    );
  });

  test("empty body-capable requests preserve a caller content-length of zero", () => {
    const prepared = prepareRequest("https://example.com", {
      headers: { "Content-Length": "0" },
    });

    expect(prepared.headers).toContain("Content-Length: 0");
  });

  test("rejects non-zero content-length on an empty body-capable request", () => {
    expect(() =>
      prepareRequest("https://example.com", {
        headers: { "Content-Length": "999" },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length does not match the request body length (0)",
    );
  });

  test("validates but does not generate content-length for empty GET", () => {
    expect(
      prepareRequest(
        "https://example.com",
        { headers: { "Content-Length": "0" } },
        "GET",
      ).headers,
    ).toContain("Content-Length: 0");

    expect(
      prepareRequest("https://example.com", {}, "GET").headers.some((header) =>
        header.toLowerCase().startsWith("content-length"),
      ),
    ).toBe(false);

    expect(() =>
      prepareRequest(
        "https://example.com",
        { headers: { "Content-Length": "1" } },
        "GET",
      ),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length does not match the request body length (0)",
    );
  });

  test("rejects a mismatched content-length before transport", () => {
    expect(() =>
      request("POST", `${SERVER_URL}/request/headers`, {
        body: "hello",
        headers: { "Content-Length": "6" },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length does not match the request body length (5)",
    );
  });

  test("transfer-encoding suppresses generated content-length", () => {
    const prepared = prepareRequest("https://example.com", {
      json: { message: "hi" },
      headers: { "Transfer-Encoding": "chunked" },
    });

    expect(prepared.headers).toContain("Transfer-Encoding: chunked");
    expect(
      prepared.headers.some((header) =>
        header.toLowerCase().startsWith("content-length"),
      ),
    ).toBe(false);
  });

  test("rejects explicit content-length alongside transfer-encoding", () => {
    expect(() =>
      prepareRequest("https://example.com", {
        body: "hello",
        headers: {
          "Content-Length": "999",
          "Transfer-Encoding": "chunked",
        },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length cannot be combined with Transfer-Encoding",
    );
  });

  test("rejects content-length and transfer-encoding before transport", () => {
    expect(() =>
      request("POST", `${SERVER_URL}/request/headers`, {
        body: "hello",
        headers: {
          "content-length": "5",
          "transfer-encoding": "chunked",
        },
      }),
    ).toThrow(
      "Request failed: Invalid request framing: Content-Length cannot be combined with Transfer-Encoding",
    );
  });
});
