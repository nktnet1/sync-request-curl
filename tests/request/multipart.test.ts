import { Blob } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import request from "#/index";
import { FormData } from "#/types";
import { SERVER_URL } from "#tests/app/config";

const upload = (form: FormData): unknown => {
  const response = request("POST", `${SERVER_URL}/upload`, { form });
  expect(response.statusCode).toStrictEqual(200);
  return response.getJSON();
};

describe("multipart/form-data", () => {
  test("uploads buffer and text fields with FormData", () => {
    const testFileLocation = "./tests/data/test-upload.txt";
    const file = fs.readFileSync(testFileLocation);
    const form = new FormData();
    form.append("1-test-file-upload", file, path.basename(testFileLocation));
    form.append("2-test-contents", "Example Content!");

    expect(upload(form)).toStrictEqual([
      {
        name: "1-test-file-upload",
        file: {
          name: path.basename(testFileLocation),
          size: file.length,
          type: expect.any(String),
          lastModified: expect.any(Number),
        },
      },
      { name: "2-test-contents", content: "Example Content!" },
    ]);
  });

  test("uploads Blob fields with filename and content type", () => {
    const contents = "Blob upload contents";
    const form = new FormData();
    form.append(
      "blob-upload",
      new Blob([contents], { type: "text/x-sync-request-curl" }),
      "blob-upload.txt",
    );

    expect(upload(form)).toStrictEqual([
      {
        name: "blob-upload",
        file: {
          name: "blob-upload.txt",
          size: Buffer.byteLength(contents),
          type: "text/x-sync-request-curl",
          lastModified: expect.any(Number),
        },
      },
    ]);
  });

  test("rejects caller-supplied content-length for multipart forms", () => {
    const form = new FormData();
    form.append("field", "value");

    expect(() =>
      request("POST", `${SERVER_URL}/upload`, {
        form,
        headers: { "Content-Length": "5" },
      }),
    ).toThrow(
      "Invalid request framing: Content-Length cannot be supplied with multipart form payloads",
    );
  });
});

test.each(["/private/path/report.txt", "C:\\private\\report.txt"])(
  "multipart filenames do not disclose local paths: %s",
  (fileName) => {
    const form = new FormData();
    form.append("file", Buffer.from("hello"), fileName);
    expect(upload(form)).toMatchObject([
      {
        name: "file",
        file: { name: "report.txt", type: "text/plain", size: 5 },
      },
    ]);
  },
);

test.each(["\0", "\r", "\n"])(
  "rejects multipart header control character %j",
  (character) => {
    const form = new FormData();
    expect(() => form.append(`key${character}`, "value")).toThrow();
    expect(() => form.append("key", "value", `file${character}.txt`)).toThrow();
  },
);

test("unnamed Buffers remain fields and unknown file types are octet streams", () => {
  const form = new FormData();
  form.append("field", Buffer.from("hello"));
  form.append("file", Buffer.from("hello"), "data.unknown-extension");
  const wire = request("POST", `${SERVER_URL}/compat/echo`, { form }).getJSON<{
    body: string;
  }>();
  expect(wire.body).toContain(
    'name="field"\r\nContent-Type: application/octet-stream\r\n',
  );
  expect(upload(form)).toMatchObject([
    { name: "field", content: "hello" },
    {
      name: "file",
      file: {
        name: "data.unknown-extension",
        type: "application/octet-stream",
      },
    },
  ]);
});
