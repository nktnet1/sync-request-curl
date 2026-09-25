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
});
