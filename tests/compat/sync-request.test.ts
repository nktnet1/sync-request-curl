import { describe, expect, test } from "vitest";
import request from "#/index";
import { SERVER_URL } from "#tests/app/config";

interface EchoResponse {
  method: string;
  search: string;
  contentType: string | null;
  customHeader: string | null;
  body: string;
  bodyHex: string;
}

describe("sync-request Node.js compatibility", () => {
  test("performs a basic synchronous GET and exposes the upstream response shape", () => {
    const response = request("get", `${SERVER_URL}/compat/echo`);

    expect(response.statusCode).toBe(200);
    expect(response.headers).toBeTypeOf("object");
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.url).toBe(`${SERVER_URL}/compat/echo`);
    expect(response.getBody()).toBeInstanceOf(Buffer);
    expect(response.getBody("utf8")).toContain('"method":"GET"');
  });

  test("matches then-request qs parsing, merging, and encoding", () => {
    const response = request(
      "GET",
      `${SERVER_URL}/compat/echo?existing=a+b&tag=one&tag=two`,
      {
        qs: {
          nested: { value: "hello world" },
          count: 2,
        },
      },
    );
    const body = response.getJSON<EchoResponse>();

    expect(body.search).toBe(
      "?existing=a%20b&tag%5B0%5D=one&tag%5B1%5D=two&nested%5Bvalue%5D=hello%20world&count=2",
    );
  });

  test("reparses an existing query when qs is an empty object", () => {
    const response = request(
      "GET",
      `${SERVER_URL}/compat/echo?value=hello+world&tag=one&tag=two`,
      { qs: {} },
    );

    expect(response.getJSON<EchoResponse>().search).toBe(
      "?value=hello%20world&tag%5B0%5D=one&tag%5B1%5D=two",
    );
  });

  test("passes caller headers and string bodies unchanged", () => {
    const response = request("POST", `${SERVER_URL}/compat/echo`, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Compat-Value": "header-value",
      },
      body: "request body",
    });

    expect(response.getJSON<EchoResponse>()).toMatchObject({
      method: "POST",
      contentType: "text/plain; charset=utf-8",
      customHeader: "header-value",
      body: "request body",
    });
  });

  test("passes Buffer bodies without text coercion", () => {
    const body = Buffer.from([0x00, 0x7f, 0x80, 0xff]);
    const response = request("PUT", `${SERVER_URL}/compat/echo`, { body });

    expect(response.getJSON<EchoResponse>()).toMatchObject({
      method: "PUT",
      bodyHex: body.toString("hex"),
    });
  });

  test("serializes json and sets the application/json content type", () => {
    const json = { message: "hello", nested: { value: 42 } };
    const response = request("PATCH", `${SERVER_URL}/compat/echo`, { json });

    expect(response.getJSON<EchoResponse>()).toMatchObject({
      method: "PATCH",
      contentType: "application/json",
      body: JSON.stringify(json),
    });
  });

  test("exposes FormData through request.FormData and sends multipart forms", () => {
    const form = new request.FormData();
    form.append("message", "hello");

    const response = request("POST", `${SERVER_URL}/upload`, { form });

    expect(response.getJSON()).toStrictEqual([
      { name: "message", content: "hello" },
    ]);
  });

  test("follows redirects by default and can leave them unresolved", () => {
    const followed = request("GET", `${SERVER_URL}/redirect/source`);
    const unresolved = request("GET", `${SERVER_URL}/redirect/source`, {
      followRedirects: false,
    });

    expect(followed.statusCode).toBe(200);
    expect(followed.url).toBe(`${SERVER_URL}/redirect/destination`);
    expect(unresolved.statusCode).toBe(302);
    expect(unresolved.url).toBe(`${SERVER_URL}/redirect/source`);
  });

  test("getBody throws the upstream status error including the decoded body", () => {
    const response = request("GET", `${SERVER_URL}/get`, {
      qs: { value: "echo" },
    });

    expect(() => response.getBody("utf8")).toThrow(
      'Server responded with status code 400:\n{"error":"Cannot echo \'echo\'!"}',
    );
  });

  test("HEAD responses expose an empty buffered body", () => {
    const response = request("HEAD", `${SERVER_URL}/compat/echo`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toStrictEqual(Buffer.alloc(0));
  });
});
