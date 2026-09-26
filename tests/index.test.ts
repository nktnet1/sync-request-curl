import { describe, expect, expectTypeOf, test } from "vitest";
import { CurlError } from "#/errors";
import request from "#/index";
import esmRequest, {
  FormData as RootFormData,
  type Options as RootOptions,
  type Response as RootResponse,
} from "#/index-esm";
import requestImplementation from "#/request/index";
import { FormData, type Options, type Response } from "#/types";

describe("public entrypoint", () => {
  test("exports the request implementation as default", () => {
    expect(request).toBe(requestImplementation);
    expect(esmRequest).toBe(requestImplementation);
  });

  test("exposes the same FormData constructor for CommonJS and ESM consumers", () => {
    expect(request.FormData).toBe(FormData);
    expect(RootFormData).toBe(FormData);
  });

  test("re-exports public types from the ESM root entry", () => {
    expectTypeOf<RootOptions>().toEqualTypeOf<Options>();
    expectTypeOf<RootResponse>().toEqualTypeOf<Response>();
  });
});

describe("request URL protocols", () => {
  test.each(["file:///tmp/example", "ftp://example.com/file"])(
    "rejects %s",
    (url) => {
      expect(() => request("GET", url)).toThrow(/protocol .* is not supported/);
    },
  );

  test("rejects schemeless URLs without letting libcurl guess", () => {
    expect(() => request("GET", "example.com/path")).toThrow(CurlError);
  });
});
