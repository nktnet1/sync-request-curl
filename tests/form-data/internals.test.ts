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

  test("supports synchronous form-data append values and options", () => {
    const form = new FormData();
    form.append("count", 3);
    form.append("enabled", true);
    form.append("file", Buffer.from("abc"), {
      filename: "nested/path/report.bin",
      contentType: "application/x-report",
      knownLength: 3,
    });

    expect(getFormDataEntries(form)).toStrictEqual([
      { key: "count", value: "3" },
      { key: "enabled", value: "true" },
      {
        key: "file",
        value: Buffer.from("abc"),
        fileName: "report.bin",
        contentType: "application/x-report",
      },
    ]);
  });

  test("exposes boundary, headers, buffer, and synchronous length APIs", () => {
    const form = new FormData();
    form.setBoundary("sync-request-curl-test-boundary");
    form.append("field", "value");
    form.append("file", Buffer.from("abc"), {
      filename: 'report".txt',
      contentType: "text/plain",
    });

    expect(form.getBoundary()).toBe("sync-request-curl-test-boundary");
    expect(
      form.getHeaders({ "X-Test": "value", "CONTENT-TYPE": "custom/type" }),
    ).toStrictEqual({
      "content-type": "custom/type",
      "x-test": "value",
    });

    const body = form.getBuffer();
    expect(body.toString()).toBe(
      [
        "--sync-request-curl-test-boundary",
        'Content-Disposition: form-data; name="field"',
        "",
        "value",
        "--sync-request-curl-test-boundary",
        'Content-Disposition: form-data; name="file"; filename="report\\".txt"',
        "Content-Type: text/plain",
        "",
        "abc",
        "--sync-request-curl-test-boundary--",
        "",
      ].join("\r\n"),
    );
    expect(form.getLengthSync()).toBe(body.length);
    expect(form.hasKnownLength()).toBe(true);
    expect(form.toString()).toBe("[object FormData]");
  });

  test("generates a stable secure boundary and validates custom boundaries", () => {
    const form = new FormData();
    const boundary = form.getBoundary();

    expect(boundary).toMatch(/^[-]{26}[0-9a-f]{24}$/);
    expect(form.getBoundary()).toBe(boundary);
    expect(() => form.setBoundary("bad boundary")).toThrow(
      "FormData boundary must contain only HTTP token characters",
    );
  });
});
