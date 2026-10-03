import { afterEach, describe, expect, test, vi } from "vitest";
import request from "#/index";
import native from "#/native/index";
import { expectRejectedBeforeNativeIo } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("URL credentials at the transport boundary", () => {
  test.each([
    "user%3Aname:secret",
    "user%0A:secret",
    "user:secret%0D",
    "user:secret%00",
    "user%:secret",
  ])("rejects unsafe URL credentials before native I/O: %s", (userinfo) => {
    expectRejectedBeforeNativeIo(() =>
      request("GET", `http://${userinfo}@example.com/start`),
    );
  });

  test.each(["reported", "omitted"])(
    "does not restore dormant Basic credentials after dropping Authorization (%s effective URL)",
    (effectiveUrl) => {
      const nativeRequest = vi
        .spyOn(native, "request")
        .mockImplementation((options) => {
          const redirect = options.url.endsWith("/start");
          return {
            transportCode: 0,
            transportMessage: "",
            statusCode: redirect ? 302 : 200,
            effectiveUrl: effectiveUrl === "reported" ? options.url : null,
            redirectUrl: redirect ? "/next" : null,
            headers: [
              redirect ? "HTTP/1.1 302 Found" : "HTTP/1.1 200 OK",
              "Content-Length: 0",
              "",
            ],
            requestHeaderOffsets: [0],
            body: Buffer.alloc(0),
          };
        });
      const response = request("GET", "http://user:secret@example.com/start", {
        headers: { Authorization: "Bearer explicit" },
      });

      expect(nativeRequest).toHaveBeenCalledTimes(2);
      const first = nativeRequest.mock.calls[0]?.[0];
      const second = nativeRequest.mock.calls[1]?.[0];
      expect(first?.url).toBe("http://example.com/start");
      expect(first?.headers).toContain("Authorization: Bearer explicit");
      expect(second?.url).toBe("http://example.com/next");
      expect(
        second?.headers.some((header) => /^authorization[:;]/i.test(header)),
      ).toBe(false);
      expect(response.url).toBe("http://example.com/next");
    },
  );

  test("an empty explicit Authorization header also discards URL credentials", () => {
    const nativeRequest = vi
      .spyOn(native, "request")
      .mockImplementation((options) => ({
        transportCode: 0,
        transportMessage: "",
        statusCode: 200,
        effectiveUrl: options.url,
        redirectUrl: null,
        headers: ["HTTP/1.1 200 OK", "Content-Length: 0", ""],
        requestHeaderOffsets: [0],
        body: Buffer.alloc(0),
      }));

    request("GET", "http://user%3Aname:secret%0A@example.com/", {
      headers: { AUTHORIZATION: "" },
    });

    expect(nativeRequest).toHaveBeenCalledTimes(1);
    expect(nativeRequest.mock.calls[0]?.[0].url).toBe("http://example.com/");
    expect(nativeRequest.mock.calls[0]?.[0].headers).toContain(
      "AUTHORIZATION;",
    );
  });
});
