import { describe, expect, test } from "vitest";
import request, { type SetEasyOptionCallback } from "../src";
import { SERVER_URL } from "./app/config";

describe("Callback setEasyOptions headers override", () => {
  const setEasyOptions: SetEasyOptionCallback = (curl, options) => {
    curl.setOpt(options.HTTPHEADER, ["value: Tammy McTamtam"]);
  };

  test("Curl easy option set for headers", () => {
    const res = request("DELETE", `${SERVER_URL}/delete`, { setEasyOptions });
    expect(JSON.parse(res.body.toString())).toStrictEqual({
      value: "Tammy McTamtam",
    });
  });

  test("Curl easy option set, override headers", () => {
    const res = request("DELETE", `${SERVER_URL}/delete`, {
      headers: { value: "override me" },
      setEasyOptions,
    });
    expect(JSON.parse(res.body.toString())).toStrictEqual({
      value: "Tammy McTamtam",
    });
  });

  test("empty PROXY disables proxy environment variables", () => {
    const previousHttpProxy = process.env.http_proxy;
    const previousNoProxy = process.env.no_proxy;
    const previousNoProxyUpper = process.env.NO_PROXY;

    process.env.http_proxy = "http://127.0.0.1:1";
    delete process.env.no_proxy;
    delete process.env.NO_PROXY;

    try {
      const res = request("GET", SERVER_URL, {
        timeout: 2_000,
        setEasyOptions: (curl, options) => {
          curl.setOpt(options.PROXY, "");
        },
      });

      expect(res.statusCode).toBe(200);
    } finally {
      if (previousHttpProxy === undefined) {
        delete process.env.http_proxy;
      } else {
        process.env.http_proxy = previousHttpProxy;
      }
      if (previousNoProxy === undefined) {
        delete process.env.no_proxy;
      } else {
        process.env.no_proxy = previousNoProxy;
      }
      if (previousNoProxyUpper === undefined) {
        delete process.env.NO_PROXY;
      } else {
        process.env.NO_PROXY = previousNoProxyUpper;
      }
    }
  });
});
