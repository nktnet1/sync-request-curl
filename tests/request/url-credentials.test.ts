import { afterEach, describe, expect, test, vi } from "vitest";
import request from "#/index";
import native from "#/native/index";
import type { Options } from "#/types/definition";
import { expectRejectedBeforeNativeIo } from "./helpers";

vi.mock("#/native/index", () => ({ default: { request: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

const urlValidationOptions: Options[] = [
  {},
  { followRedirects: false },
  { cache: "file" },
  { cache: "memory" },
  { qs: {} },
  { qs: {}, followRedirects: false },
  { auth: { username: "user", password: "secret" } },
  { headers: { Authorization: "Bearer explicit" } },
];

const invalidUrlCases = [
  {
    message: "unescaped space or control character",
    urls: [
      "http://exam\nple.com/resource",
      "http://example.com/res\0ource",
      "http://example.com/resource#space fragment",
      "http://example.com/resource?q=raw\tvalue",
    ],
  },
  {
    message: "ambiguous authority",
    urls: [
      "http://trusted.test\\@other.test/resource",
      "http:/trusted.test\\@other.test/resource",
      "http:///trusted.test\\@other.test/resource",
    ],
  },
].flatMap(({ message, urls }) => urls.map((url) => ({ message, url })));

describe("URL credentials at the transport boundary", () => {
  test.each(invalidUrlCases)(
    "rejects invalid URL $url before credentials or native I/O",
    ({ message, url }) => {
      for (const options of urlValidationOptions) {
        expectRejectedBeforeNativeIo(
          () => request("GET", url, options),
          message,
        );
      }
    },
  );

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

  test.each(
    [1, 2, 3].flatMap((slashes) =>
      ["reported", "omitted"].map((effectiveUrl) => ({
        slashes,
        effectiveUrl,
      })),
    ),
  )(
    "does not restore dormant Basic credentials after dropping Authorization ($slashes slashes, $effectiveUrl effective URL)",
    ({ slashes, effectiveUrl }) => {
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
      const prefix = `http:${"/".repeat(slashes)}`;
      const response = request(
        "GET",
        `${prefix}user:secret@example.com/start`,
        {
          headers: { Authorization: "Bearer explicit" },
        },
      );

      expect(nativeRequest).toHaveBeenCalledTimes(2);
      const first = nativeRequest.mock.calls[0]?.[0];
      const second = nativeRequest.mock.calls[1]?.[0];
      expect(first?.url).toBe(`${prefix}example.com/start`);
      expect(first?.headers).toContain("Authorization: Bearer explicit");
      expect(second?.url).toBe("http://example.com/next");
      expect(
        second?.headers.some((header) => /^authorization[:;]/i.test(header)),
      ).toBe(false);
      expect(response.url).toBe("http://example.com/next");
    },
  );

  test.each([1, 2, 3])(
    "an empty explicit Authorization header also discards URL credentials with %i slashes",
    (slashes) => {
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

      const prefix = `http:${"/".repeat(slashes)}`;
      request("GET", `${prefix}user%3Aname:secret%0A@example.com/`, {
        headers: { AUTHORIZATION: "" },
      });

      expect(nativeRequest).toHaveBeenCalledTimes(1);
      expect(nativeRequest.mock.calls[0]?.[0].url).toBe(
        `${prefix}example.com/`,
      );
      expect(nativeRequest.mock.calls[0]?.[0].headers).toContain(
        "AUTHORIZATION;",
      );
    },
  );
});
