import { describe, expect, test } from "vitest";
import request from "#/index";
import { FormData } from "#/types";
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

describe("HTTP method semantics", () => {
  test("rejects CONNECT because the buffered API cannot expose its tunnel", () => {
    expect(() => request("CONNECT", SERVER_URL)).toThrow(
      "CONNECT is not supported by the buffered request API",
    );
  });

  test.each([
    ["raw body", { body: "trace-content" }],
    ["JSON", { json: { trace: true } }],
  ] as const)("rejects TRACE content supplied as %s", (_case, options) => {
    expect(() =>
      request("TRACE", `${SERVER_URL}/compat/echo`, options),
    ).toThrow("TRACE requests cannot contain content");
  });

  test("rejects TRACE multipart content", () => {
    const form = new FormData();
    form.append("trace", "content");

    expect(() =>
      request("TRACE", `${SERVER_URL}/compat/echo`, { form }),
    ).toThrow("TRACE requests cannot contain content");
  });

  test("allows an explicitly empty TRACE raw body", () => {
    const response = request("TRACE", `${SERVER_URL}/compat/echo`, {
      body: "",
    });

    expect(response.statusCode).toBe(200);
    expect(response.getJSON()).toMatchObject({ method: "TRACE", body: "" });
  });

  test("rejects OPTIONS content without a content type", () => {
    expect(() =>
      request("OPTIONS", `${SERVER_URL}/compat/echo`, { body: "options" }),
    ).toThrow("OPTIONS requests with content require Content-Type");
  });

  test("rejects OPTIONS content with an explicitly empty content type", () => {
    expect(() =>
      request("OPTIONS", `${SERVER_URL}/compat/echo`, {
        body: "options",
        headers: { "Content-Type": "" },
      }),
    ).toThrow("OPTIONS requests with content require Content-Type");
  });

  test("allows OPTIONS raw content with an explicit content type", () => {
    const response = request("OPTIONS", `${SERVER_URL}/compat/echo`, {
      body: "options",
      headers: { "Content-Type": "text/plain" },
    });

    expect(response.getJSON()).toMatchObject({
      method: "OPTIONS",
      body: "options",
      contentType: "text/plain",
    });
  });

  test("allows OPTIONS JSON with its generated content type", () => {
    const response = request("OPTIONS", `${SERVER_URL}/compat/echo`, {
      json: { options: true },
    });

    expect(response.getJSON()).toMatchObject({
      method: "OPTIONS",
      contentType: "application/json",
      body: '{"options":true}',
    });
  });

  test("allows OPTIONS multipart with libcurl's generated content type", () => {
    const form = new FormData();
    form.append("options", "true");

    const response = request("OPTIONS", `${SERVER_URL}/compat/echo`, { form });
    const json = response.getJSON() as { contentType: string };

    expect(json.contentType).toMatch(/^multipart\/form-data; boundary=/);
  });
});
