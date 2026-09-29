import { describe, expect, expectTypeOf, test } from "vitest";
import {
  CurlError,
  RequestError,
  type RequestErrorCode,
  ResponseError,
} from "#/errors";
import { FormData } from "#/form-data";
import request, {
  type HttpVerb as CommonJsRootHttpVerb,
  type Options as CommonJsRootOptions,
  type Response as CommonJsRootResponse,
} from "#/index";
import esmRequest, {
  CurlError as RootCurlError,
  FormData as RootFormData,
  type Options as RootOptions,
  RequestError as RootRequestError,
  type RequestErrorCode as RootRequestErrorCode,
  type Response as RootResponse,
  ResponseError as RootResponseError,
} from "#/index-esm";
import requestImplementation from "#/request/index";
import type { HttpVerb, Options, Response } from "#/types";

describe("public entrypoint", () => {
  test("exports the request implementation as default", () => {
    expect(request).toBe(requestImplementation);
    expect(esmRequest).toBe(requestImplementation);
  });

  test("re-exports public runtime values from the ESM root entry", () => {
    expect(RootFormData).toBe(FormData);
    expect(RootCurlError).toBe(CurlError);
    expect(RootRequestError).toBe(RequestError);
    expect(RootResponseError).toBe(ResponseError);
  });

  test("re-exports public declarations from the CommonJS root entry", () => {
    type CommonJsRootFormData = typeof import("#/index").FormData;
    type CommonJsRootCurlError = typeof import("#/index").CurlError;
    type CommonJsRootRequestError = typeof import("#/index").RequestError;
    type CommonJsRootResponseError = typeof import("#/index").ResponseError;

    expectTypeOf<CommonJsRootFormData>().toEqualTypeOf<typeof FormData>();
    expectTypeOf<CommonJsRootCurlError>().toEqualTypeOf<typeof CurlError>();
    expectTypeOf<CommonJsRootRequestError>().toEqualTypeOf<
      typeof RequestError
    >();
    expectTypeOf<CommonJsRootResponseError>().toEqualTypeOf<
      typeof ResponseError
    >();
    expectTypeOf<CommonJsRootHttpVerb>().toEqualTypeOf<HttpVerb>();
    expectTypeOf<CommonJsRootOptions>().toEqualTypeOf<Options>();
    expectTypeOf<CommonJsRootResponse>().toEqualTypeOf<Response>();
  });

  test("re-exports public types from the ESM root entry", () => {
    expectTypeOf<RootOptions>().toEqualTypeOf<Options>();
    expectTypeOf<RootResponse>().toEqualTypeOf<Response>();
    expectTypeOf<RootRequestErrorCode>().toEqualTypeOf<RequestErrorCode>();
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
