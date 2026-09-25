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
  HttpVerb,
  JsonLike,
  Options,
  Response,
  UppercaseHttpVerb,
} from "#/types";
import {
  type bufferEncodingSchema,
  type httpVerbInputSchema,
  httpVerbSchema,
  incomingHttpHeadersSchema,
  type jsonLikeSchema,
  optionsSchema,
  requestUrlSchema,
  type responseDataSchema,
  type uppercaseHttpVerbSchema,
} from "#/validation";

describe("schema-derived types", () => {
  test("keeps public data types tied to their schemas", () => {
    expectTypeOf<FormDataEntry>().toEqualTypeOf<
      v.InferOutput<typeof formDataEntrySchema>
    >();
    expectTypeOf<FormDataEntry["value"]>().toEqualTypeOf<
      string | Buffer | Blob
    >();
    expectTypeOf<JsonLike>().toEqualTypeOf<
      v.InferOutput<typeof jsonLikeSchema>
    >();
    expectTypeOf<UppercaseHttpVerb>().toEqualTypeOf<
      v.InferOutput<typeof uppercaseHttpVerbSchema>
    >();
    expectTypeOf<HttpVerb>().toEqualTypeOf<
      v.InferOutput<typeof httpVerbInputSchema>
    >();
    expectTypeOf<BufferEncoding>().toEqualTypeOf<
      v.InferOutput<typeof bufferEncodingSchema>
    >();
    expectTypeOf<Options>().toEqualTypeOf<
      v.InferOutput<typeof optionsSchema>
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
  test("normalizes supported HTTP methods and rejects unsupported methods", () => {
    expect(v.parse(httpVerbSchema, "post")).toBe("POST");
    expect(v.safeParse(httpVerbSchema, "BREW").success).toBe(false);
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
    expect(v.safeParse(optionsSchema, { timeout: "fast" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { socketTimeout: -1 }).success).toBe(
      false,
    );
    expect(
      v.safeParse(optionsSchema, { socketTimeout: Number.NaN }).success,
    ).toBe(false);
    expect(v.safeParse(optionsSchema, { gzip: "yes" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { cache: "file" }).success).toBe(true);
    expect(v.safeParse(optionsSchema, { cache: "memory" }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { agent: false }).success).toBe(true);
    expect(v.safeParse(optionsSchema, { agent: true }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { agent: {} }).success).toBe(false);
    expect(v.safeParse(optionsSchema, { retry: "yes" }).success).toBe(false);
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
