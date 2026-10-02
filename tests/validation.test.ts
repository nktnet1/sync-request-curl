import type { Blob } from "node:buffer";
import { Agent } from "node:http";
import { URL } from "node:url";
import * as v from "valibot";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { FormDataEntry, formDataEntrySchema } from "#/form-data";
import type {
  NativeRequestOptions,
  NativeResponse,
  nativeRequestOptionsSchema,
  nativeResponseSchema,
} from "#/native/index";
import type {
  LinuxLibc,
  linuxLibcSchema,
  NativePlatformKey,
  nativePlatformKeySchema,
} from "#/native/platform-key";
import type {
  BufferEncoding,
  Headers,
  HttpAuthOptions,
  HttpAuthType,
  HttpVerb,
  HttpVersion,
  IpFamily,
  JsonLike,
  JsonPrimitive,
  NestedJsonLike,
  Options,
  ProxyAuthType,
  ProxyOptions,
  Response,
  UppercaseHttpVerb,
} from "#/types/definition";
import { parseSchema } from "#/validate";
import {
  type bufferEncodingSchema,
  type httpAuthSchema,
  type httpAuthTypeSchema,
  type httpVerbInputSchema,
  httpVerbSchema,
  incomingHttpHeadersSchema,
  type jsonLikeSchema,
  optionsSchema,
  type proxyAuthTypeSchema,
  type proxySchema,
  requestUrlSchema,
  type responseDataSchema,
  uppercaseHttpVerbSchema,
} from "#/validation";

describe("schema-aligned types", () => {
  test("preserves Node's well-known response header types", () => {
    expectTypeOf<Response["headers"]>().toEqualTypeOf<Headers>();
    expectTypeOf<Response["headers"]["content-type"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Response["headers"]["set-cookie"]>().toEqualTypeOf<
      string[] | undefined
    >();
  });

  test("keeps public data types tied to their schemas", () => {
    expectTypeOf<FormDataEntry>().toEqualTypeOf<
      v.InferOutput<typeof formDataEntrySchema>
    >();
    expectTypeOf<FormDataEntry["value"]>().toEqualTypeOf<
      string | number | boolean | Buffer | Blob
    >();
    expectTypeOf<JsonPrimitive>().toEqualTypeOf<
      string | number | boolean | null
    >();
    expectTypeOf<Options["httpVersion"]>().toEqualTypeOf<
      HttpVersion | undefined
    >();
    expectTypeOf<Options["family"]>().toEqualTypeOf<IpFamily | undefined>();
    expectTypeOf<
      Exclude<Options["tcpKeepAlive"], boolean | undefined>
    >().toEqualTypeOf<{
      idleSeconds?: number;
      intervalSeconds?: number;
      probeCount?: number;
    }>();
    expectTypeOf<NestedJsonLike>().toMatchTypeOf<
      JsonLike | undefined | { toJSON(): NestedJsonLike }
    >();
    expectTypeOf<JsonLike>().toEqualTypeOf<
      v.InferOutput<typeof jsonLikeSchema>
    >();
    expectTypeOf<UppercaseHttpVerb>().toEqualTypeOf<
      v.InferOutput<typeof uppercaseHttpVerbSchema>
    >();
    type StandardVerb =
      | "GET"
      | "HEAD"
      | "POST"
      | "PUT"
      | "DELETE"
      | "CONNECT"
      | "OPTIONS"
      | "TRACE"
      | "PATCH"
      | "PROPFIND";
    expectTypeOf<HttpVerb>().toEqualTypeOf<
      StandardVerb | Lowercase<StandardVerb>
    >();
    expectTypeOf<
      v.InferOutput<typeof httpVerbInputSchema>
    >().toEqualTypeOf<string>();
    expectTypeOf<BufferEncoding>().toEqualTypeOf<
      v.InferOutput<typeof bufferEncodingSchema>
    >();
    expectTypeOf<HttpAuthOptions>().toEqualTypeOf<
      v.InferOutput<typeof httpAuthSchema>
    >();
    expectTypeOf<HttpAuthType>().toEqualTypeOf<
      v.InferOutput<typeof httpAuthTypeSchema>
    >();
    expectTypeOf<ProxyOptions>().toEqualTypeOf<
      v.InferOutput<typeof proxySchema>
    >();
    expectTypeOf<ProxyAuthType>().toEqualTypeOf<
      v.InferOutput<typeof proxyAuthTypeSchema>
    >();
    expectTypeOf<Options>().toEqualTypeOf<
      v.InferOutput<typeof optionsSchema>
    >();
    expectTypeOf<Options["headers"]>().toEqualTypeOf<Headers | undefined>();
    expectTypeOf<Options["agent"]>().toEqualTypeOf<
      boolean | Agent | undefined
    >();
    expectTypeOf<NativeRequestOptions>().toEqualTypeOf<
      v.InferOutput<typeof nativeRequestOptionsSchema>
    >();
    expectTypeOf<NativeResponse>().toEqualTypeOf<
      v.InferOutput<typeof nativeResponseSchema>
    >();
    expectTypeOf<NativePlatformKey>().toEqualTypeOf<
      v.InferOutput<typeof nativePlatformKeySchema>
    >();
    expectTypeOf<LinuxLibc>().toEqualTypeOf<
      v.InferOutput<typeof linuxLibcSchema>
    >();
    expectTypeOf<
      Pick<Response, "statusCode" | "headers" | "url" | "body">
    >().toEqualTypeOf<v.InferOutput<typeof responseDataSchema>>();
  });
});

describe("runtime validation", () => {
  test("summarizes validation issues without exposing Valibot errors", () => {
    const parseInvalid = () => parseSchema(v.string("Expected a string"), 123);

    expect(parseInvalid).toThrow(TypeError);
    expect(parseInvalid).toThrow("Expected a string");

    try {
      parseInvalid();
    } catch (error) {
      expect(error).not.toBeInstanceOf(v.ValiError);
    }
  });

  test("validates uppercase HTTP methods", () => {
    expect(v.parse(uppercaseHttpVerbSchema, "GET")).toBe("GET");
    expect(v.parse(uppercaseHttpVerbSchema, "PROPFIND")).toBe("PROPFIND");
    expect(v.safeParse(uppercaseHttpVerbSchema, "post").success).toBe(false);
    expect(v.safeParse(uppercaseHttpVerbSchema, "bad method").success).toBe(
      false,
    );
  });

  test("normalizes standard and extension HTTP methods", () => {
    expect(v.parse(httpVerbSchema, "post")).toBe("POST");
    expect(v.parse(httpVerbSchema, "propfind")).toBe("PROPFIND");
    expect(v.safeParse(httpVerbSchema, "bad method").success).toBe(false);
    expect(v.safeParse(httpVerbSchema, "").success).toBe(false);
    expect(v.safeParse(httpVerbSchema, 123).success).toBe(false);
  });

  test("accepts string and URL request targets", () => {
    expect(v.parse(requestUrlSchema, "https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(
      v.parse(requestUrlSchema, new URL("https://example.com/other")),
    ).toBe("https://example.com/other");
  });

  test("validates request options and header values", () => {
    expect(
      v.safeParse(optionsSchema, {
        headers: { "x-test": ["one", "two"] },
        timeout: 100,
        connectTimeout: 75,
        socketTimeout: 50,
        followRedirects: true,
        gzip: false,
        cache: "file",
        agent: new Agent({ keepAlive: true }),
        retry: true,
        retryDelay: 200,
        maxRetries: 5,
      }).success,
    ).toBe(true);
    expect(v.safeParse(optionsSchema, null).success).toBe(false);
    expect(v.safeParse(optionsSchema, { timeout: "fast" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { connectTimeout: -1 }).success).toBe(
      false,
    );
    expect(
      v.safeParse(optionsSchema, { connectTimeout: Number.NaN }).success,
    ).toBe(false);
    expect(v.safeParse(optionsSchema, { socketTimeout: -1 }).success).toBe(
      false,
    );
    expect(
      v.safeParse(optionsSchema, { socketTimeout: Number.NaN }).success,
    ).toBe(false);
    expect(v.safeParse(optionsSchema, { gzip: "yes" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { cache: "file" }).success).toBe(true);
    expect(v.safeParse(optionsSchema, { cache: "memory" }).success).toBe(true);
    expect(v.safeParse(optionsSchema, { cache: "custom" }).success).toBe(false);
    expect(
      v.safeParse(optionsSchema, {
        cache: {
          getResponse: () => undefined,
          setResponse: () => undefined,
          invalidateResponse: () => undefined,
        },
      }).success,
    ).toBe(false);
    expect(v.safeParse(optionsSchema, { isMatch: () => true }).success).toBe(
      true,
    );
    expect(v.safeParse(optionsSchema, { isExpired: () => false }).success).toBe(
      true,
    );
    expect(v.safeParse(optionsSchema, { canCache: () => true }).success).toBe(
      true,
    );
    expect(v.safeParse(optionsSchema, { isMatch: true }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { isExpired: 0 }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { canCache: "yes" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { agent: false }).success).toBe(true);
    expect(v.safeParse(optionsSchema, { agent: true }).success).toBe(true);
    expect(v.safeParse(optionsSchema, { agent: {} }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { retry: () => true }).success).toBe(
      true,
    );
    expect(v.safeParse(optionsSchema, { retry: "yes" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { retryDelay: () => 10 }).success).toBe(
      true,
    );
    expect(v.safeParse(optionsSchema, { retryDelay: -1 }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { retryDelay: Number.NaN }).success).toBe(
      false,
    );
    expect(v.safeParse(optionsSchema, { maxRetries: -1 }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { maxRetries: 1.5 }).success).toBe(false);
    expect(
      v.safeParse(optionsSchema, { maxRedirects: Number.NaN }).success,
    ).toBe(false);
    expect(
      v.safeParse(incomingHttpHeadersSchema, { "x-invalid": 123 }).success,
    ).toBe(false);
  });
});

describe("HTTP authentication validation", () => {
  test.each([
    { username: "user" },
    { username: "", password: "" },
    { username: "user", password: "secret", type: "basic" },
    { username: "user", password: "secret", type: "digest" },
    { username: "user", password: "secret", type: "ntlm" },
    { username: "user", password: "secret", type: "negotiate" },
    { username: "user", password: "secret", type: "any" },
    { bearer: "token" },
  ])("accepts %j", (auth) => {
    expect(v.is(optionsSchema, { auth })).toBe(true);
  });

  test.each([
    null,
    {},
    { password: "secret" },
    { type: "basic" },
    { bearer: "" },
    { bearer: "bad\0token" },
    { username: "bad\0user" },
    { username: "user", password: "bad\0password" },
    { username: "user", type: "bearer" },
    { username: "user", bearer: "token" },
    { bearer: "token", type: "any" },
  ])("rejects %j", (auth) => {
    expect(v.is(optionsSchema, { auth })).toBe(false);
  });
});

describe("proxy object validation", () => {
  test.each([
    { url: "http://localhost:8080" },
    { url: "https://localhost:8080", auth: "any" },
    { url: "socks4://localhost:1080" },
    { url: "socks4a://localhost:1080" },
    { url: "socks5://localhost:1080" },
    { url: "socks5h://localhost:1080" },
    { url: "http://localhost:8080", username: "user" },
    { url: "http://localhost:8080", username: "user", password: "secret" },
    { url: "http://localhost:8080", username: "", password: "" },
    { url: "http://localhost:8080", username: "", password: "secret" },
    {
      url: "http://localhost:8080",
      auth: "digest",
      noProxy: ["localhost", "127.0.0.0/8", "*"],
      headers: { "x-proxy-trace": "trace-id" },
    },
  ])("accepts proxy configuration %j", (proxy) => {
    expect(v.is(optionsSchema, { proxy })).toBe(true);
  });

  test.each([
    "http://localhost:8080",
    null,
    {},
    { url: "" },
    { url: "http://localhost:8080", password: "secret" },
    { url: "http://localhost:8080", password: "" },
    { url: "http://localhost:8080", username: 123 },
    { url: "http://localhost:8080", username: "user", password: null },
    { url: "http://localhost:8080", username: "bad\0" },
    { url: "http://localhost:8080", username: "user", password: "bad\0" },
    { url: "http://localhost:8080", auth: "bearer" },
    { url: "http://localhost:8080", noProxy: "localhost" },
    { url: "http://localhost:8080", noProxy: [""] },
    { url: "http://localhost:8080", noProxy: ["localhost,example.com"] },
    { url: "http://localhost:8080", noProxy: ["bad\0host"] },
    { url: "http://localhost:8080", headers: { "x-test": 123 } },
  ])("rejects invalid proxy configuration %j", (proxy) => {
    expect(v.is(optionsSchema, { proxy })).toBe(false);
  });

  test("rejects legacy authentication instead of silently sending an unauthenticated request", () => {
    expect(
      v.is(optionsSchema, { proxyAuth: { username: "u", password: "p" } }),
    ).toBe(false);
    expect(
      v.is(optionsSchema, {
        proxy: { url: "http://localhost:8080" },
        proxyAuth: { username: "u", password: "p" },
      }),
    ).toBe(false);
  });
});

describe("HTTP version validation", () => {
  test.each([
    "auto",
    "1.0",
    "1.1",
    "2",
    "2-tls",
    "2-prior-knowledge",
    "3",
    "3-only",
  ] as const)("accepts %s", (httpVersion) => {
    expect(v.is(optionsSchema, { httpVersion })).toBe(true);
  });

  test.each(["", "2.0", "http2", "4", 2, null])("rejects %j", (httpVersion) => {
    expect(v.is(optionsSchema, { httpVersion })).toBe(false);
  });
});

describe("IP family validation", () => {
  test.each([0, 4, 6] as const)("accepts %s", (family) => {
    expect(v.is(optionsSchema, { family })).toBe(true);
  });

  test.each([-1, 1, 5, "4", null])("rejects %j", (family) => {
    expect(v.is(optionsSchema, { family })).toBe(false);
  });
});

describe("TCP keepalive validation", () => {
  test.each([
    true,
    false,
    {},
    { idleSeconds: 1 },
    { intervalSeconds: 1 },
    { probeCount: 1 },
    { idleSeconds: 30, intervalSeconds: 5, probeCount: 3 },
  ])("accepts %j", (tcpKeepAlive) => {
    expect(v.is(optionsSchema, { tcpKeepAlive })).toBe(true);
  });

  test.each([
    { probeCount: 0 },
    { probeCount: -1 },
    { probeCount: 1.5 },
    { probeCount: 2_147_483_648 },
    { probeCount: "3" },
  ])("rejects %j", (tcpKeepAlive) => {
    expect(v.is(optionsSchema, { tcpKeepAlive })).toBe(false);
  });
});
