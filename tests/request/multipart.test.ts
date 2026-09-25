import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import request from "#/index";
import { FormData } from "#/types";
import { SERVER_URL } from "#tests/app/config";

describe("multipart/form-data", () => {
  test("uploads buffer and text fields with FormData", () => {
    const testFileLocation = "./tests/data/test-upload.txt";
    const file = fs.readFileSync(testFileLocation);
    const form = new FormData();
    form.append("1-test-file-upload", file, path.basename(testFileLocation));
    form.append("2-test-contents", "Example Content!");

    const res = request("POST", `${SERVER_URL}/upload`, { form });

    expect(res.statusCode).toStrictEqual(200);
    expect(res.getJSON()).toStrictEqual([
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
});
