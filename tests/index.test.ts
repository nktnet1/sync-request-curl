import { describe, expect, test } from "vitest";
import request from "../src/index";
import requestImplementation from "../src/request";

describe("public entrypoint", () => {
  test("exports the request implementation as default", () => {
    expect(request).toBe(requestImplementation);
  });
});
