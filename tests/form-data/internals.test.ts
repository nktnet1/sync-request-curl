import { describe, expect, test } from "vitest";
import { FormData, getFormDataEntries } from "#/form-data";

describe("FormData internals", () => {
  test("rejects values that are not library FormData instances", () => {
    expect(() => getFormDataEntries({} as FormData)).toThrow(
      "Expected a FormData instance created by sync-request-curl",
    );
  });

  test("rejects append calls with an invalid receiver", () => {
    expect(() =>
      FormData.prototype.append.call({} as FormData, "field", "value"),
    ).toThrow("Expected a FormData instance created by sync-request-curl");
  });
});
