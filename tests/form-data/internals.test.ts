import { Blob, File } from "node:buffer";
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

  test("materializes Blob values synchronously with multipart metadata", () => {
    const form = new FormData();
    form.append(
      "blob",
      new Blob([Buffer.from([0, 1, 2, 255])], { type: "application/x-test" }),
    );

    expect(getFormDataEntries(form)).toStrictEqual([
      {
        key: "blob",
        value: Buffer.from([0, 1, 2, 255]),
        fileName: "blob",
        contentType: "application/x-test",
      },
    ]);
  });

  test("uses File names and Blob content-type defaults", () => {
    const form = new FormData();
    form.append("file", new File(["file contents"], "example.txt"));
    form.append("custom", new Blob(["custom"]), "custom.bin");
    form.append("empty", new Blob([]));

    expect(getFormDataEntries(form)).toStrictEqual([
      {
        key: "file",
        value: Buffer.from("file contents"),
        fileName: "example.txt",
        contentType: "application/octet-stream",
      },
      {
        key: "custom",
        value: Buffer.from("custom"),
        fileName: "custom.bin",
        contentType: "application/octet-stream",
      },
      {
        key: "empty",
        value: Buffer.alloc(0),
        fileName: "blob",
        contentType: "application/octet-stream",
      },
    ]);
  });
});
