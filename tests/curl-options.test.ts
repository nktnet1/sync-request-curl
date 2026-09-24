import { describe, expect, test } from "vitest";
import { curlOption, EasyOptions } from "#/curl";
import type { CurlOptionInput, CurlOptionValue } from "#/types";

describe("EasyOptions", () => {
  test("stores supported string and keep-alive options", () => {
    const easy = new EasyOptions(["X-Initial: value"]);

    easy.setOpt(curlOption.PROXY, "http://localhost:8080");
    easy.setOpt(curlOption.PROXYUSERPWD, ["proxy", "auth"].join(":"));
    easy.setOpt(curlOption.USERAGENT, "sync-request-curl-test");
    easy.setOpt(curlOption.REFERER, "https://example.com/");
    easy.setOpt(curlOption.CAINFO, "/tmp/ca.pem");
    easy.setOpt(curlOption.INTERFACE, "127.0.0.1");
    easy.setOpt(curlOption.DNS_SERVERS, "1.1.1.1");
    easy.setOpt(curlOption.TCP_KEEPALIVE, 1);

    expect(easy.snapshot()).toStrictEqual({
      headers: ["X-Initial: value"],
      curlOptions: {
        proxy: "http://localhost:8080",
        proxyUserPwd: "proxy:auth",
        userAgent: "sync-request-curl-test",
        referer: "https://example.com/",
        caInfo: "/tmp/ca.pem",
        interface: "127.0.0.1",
        dnsServers: "1.1.1.1",
        tcpKeepAlive: true,
      },
    });
  });

  test("replaces HTTP headers and accepts boolean keep-alive", () => {
    const easy = new EasyOptions(["X-Initial: value"]);

    easy.setOpt(curlOption.HTTPHEADER, ["X-Replaced: value"]);
    easy.setOpt(curlOption.TCP_KEEPALIVE, false);

    expect(easy.snapshot()).toStrictEqual({
      headers: ["X-Replaced: value"],
      curlOptions: { tcpKeepAlive: false },
    });
  });

  const invalidStringOptions: Array<[CurlOptionValue, CurlOptionInput]> = [
    [curlOption.PROXY, true],
    [curlOption.PROXYUSERPWD, 1],
    [curlOption.USERAGENT, false],
    [curlOption.REFERER, ["invalid"]],
    [curlOption.CAINFO, 1],
    [curlOption.INTERFACE, false],
    [curlOption.DNS_SERVERS, 1],
  ];

  test.each(invalidStringOptions)(
    "rejects non-string value for option %i",
    (option, value) => {
      const easy = new EasyOptions([]);
      expect(() => easy.setOpt(option, value)).toThrow(/must be a string/);
    },
  );

  test("rejects invalid HTTPHEADER values", () => {
    const easy = new EasyOptions([]);

    expect(() => easy.setOpt(curlOption.HTTPHEADER, "X-Test: value")).toThrow(
      "HTTPHEADER must be an array of strings",
    );
    const mixedHeaders = ["X-Test: value", 1] as unknown as string[];
    expect(() => easy.setOpt(curlOption.HTTPHEADER, mixedHeaders)).toThrow(
      "HTTPHEADER must be an array of strings",
    );
  });

  test("rejects invalid TCP_KEEPALIVE values", () => {
    const easy = new EasyOptions([]);
    expect(() => easy.setOpt(curlOption.TCP_KEEPALIVE, "yes")).toThrow(
      "TCP_KEEPALIVE must be a boolean or number",
    );
  });

  test("rejects unsupported options", () => {
    const easy = new EasyOptions([]);
    expect(() => easy.setOpt(999 as CurlOptionValue, "value")).toThrow(
      "Unsupported cURL option: 999",
    );
  });

  test("closed handles reject mutations and snapshots", () => {
    const easy = new EasyOptions([]);
    expect(easy.isOpen).toBe(true);

    easy.close();

    expect(easy.isOpen).toBe(false);
    expect(() => easy.setOpt(curlOption.USERAGENT, "test")).toThrow(
      "Cannot set an option on a closed cURL handle",
    );
    expect(() => easy.snapshot()).toThrow(
      "Cannot read options from a closed cURL handle",
    );
  });

  test("snapshot returns copies", () => {
    const easy = new EasyOptions(["X-Test: one"]);
    easy.setOpt(curlOption.USERAGENT, "agent");

    const snapshot = easy.snapshot();
    snapshot.headers.push("X-Test: two");
    snapshot.curlOptions.userAgent = "changed";

    expect(easy.snapshot()).toStrictEqual({
      headers: ["X-Test: one"],
      curlOptions: { userAgent: "agent" },
    });
  });
});
