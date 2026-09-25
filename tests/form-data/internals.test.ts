import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { FormData, getFormDataEntries } from "#/form-data";

const detachedFormData = (): FormData =>
  v.parse(v.instance(FormData), Object.create(FormData.prototype));

describe("FormData internals", () => {
  test("rejects objects that did not run the FormData constructor", () => {
    expect(() => getFormDataEntries(detachedFormData())).toThrow(
      "Expected a FormData instance created by sync-request-curl",
    );
  });

  test("append rejects an invalid receiver", () => {
    expect(() =>
      FormData.prototype.append.call(detachedFormData(), "field", "value"),
    ).toThrow("Expected a FormData instance created by sync-request-curl");
  });
});
