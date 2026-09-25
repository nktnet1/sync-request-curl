import { describe, expect, test } from "vitest";
import request from "#/index";
import requestImplementation from "#/request/index";
import { FormData } from "#/types";

describe("public entrypoint", () => {
  test("exports the request implementation as default", () => {
    expect(request).toBe(requestImplementation);
  });

  test("exposes FormData as a CommonJS-compatible property", () => {
    expect(request.FormData).toBe(FormData);
  });
});
