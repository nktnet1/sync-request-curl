import { describe, expect, test } from "vitest";
import request, { FormData } from "../src/index";
import requestImplementation from "../src/request";

describe("public entrypoint", () => {
  test("exports the request implementation as default", () => {
    expect(request).toBe(requestImplementation);
  });

  test("exposes FormData as a named and CommonJS-compatible property", () => {
    expect(request.FormData).toBe(FormData);
  });
});
