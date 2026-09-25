import { describe, expect, test } from "vitest";
import request, { FormData } from "#/index";
import requestImplementation from "#/request/index";

describe("public entrypoint", () => {
  test("exports the request implementation as default", () => {
    expect(request).toBe(requestImplementation);
  });

  test("exposes FormData as a named and CommonJS-compatible property", () => {
    expect(request.FormData).toBe(FormData);
  });
});
