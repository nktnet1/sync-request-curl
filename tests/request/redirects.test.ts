import { describe, expect, test, vi } from "vitest";
import request from "#/index";
import { SERVER_URL } from "../app/config";
import { wrapperRequest } from "./helpers";

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

  test("Native redirects enforce maxRedirects", () => {
    expect(() =>
      request("GET", `${SERVER_URL}/redirect/source`, {
        qs: { redirectNumber: 2 },
        maxRedirects: 1,
      }),
    ).toThrow(Error);
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

  test.each([Number.NaN, -1])(
    "treats maxRedirects=%s as unbounded",
    (maxRedirects) => {
      const res = wrapperRequest("GET", SERVER_URL, { maxRedirects });

      expect(res).toMatchObject({
        code: 200,
        json: { message: "Hello, world!" },
      });
    },
  );

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

  test("Native redirects change PUT to GET after a 303 redirect", () => {
    const res = wrapperRequest("PUT", `${SERVER_URL}/redirect/method/303`);
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

  test.each(["same-origin", "cross-origin"])(
    "%s redirect drops custom headers by default",
    (redirectType) => {
      const res = wrapperRequest(
        "GET",
        `${SERVER_URL}/redirect/headers/${redirectType}`,
        { headers: { "x-api-key": "secret" } },
      );
      expect(res).toMatchObject({
        code: 200,
        json: { apiKey: null, traceId: null },
      });
    },
  );

  test.each(["same-origin", "cross-origin"])(
    "%s redirect forwards only allow-listed headers case-insensitively",
    (redirectType) => {
      const res = wrapperRequest(
        "GET",
        `${SERVER_URL}/redirect/headers/${redirectType}`,
        {
          headers: {
            "X-API-Key": "secret",
            "x-trace-id": "trace",
          },
          allowRedirectHeaders: ["x-api-KEY"],
        },
      );
      expect(res).toMatchObject({
        code: 200,
        json: { apiKey: "secret", traceId: null },
      });
    },
  );

  test("redirect drops headers when allow-list has no matching names", () => {
    const res = wrapperRequest(
      "GET",
      `${SERVER_URL}/redirect/headers/same-origin`,
      {
        headers: { "x-trace-id": "trace" },
        allowRedirectHeaders: ["x-api-key"],
      },
    );
    expect(res).toMatchObject({
      code: 200,
      json: { apiKey: null, traceId: null },
    });
  });

  test.runIf(process.env.RUN_EXTERNAL_TEST === "1")(
    "External URL redirect - https://picsum.photos/200/300",
    () => {
      const redirectResponse = wrapperRequest(
        "GET",
        "https://picsum.photos/200/300",
      );
      expect(redirectResponse).toMatchObject({ code: 200 });
      const noRedirect = wrapperRequest(
        "GET",
        "https://picsum.photos/200/300",
        {
          followRedirects: false,
        },
      );
      expect(noRedirect).toMatchObject({ code: 302 });
    },
  );
});
