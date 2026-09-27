import { describe, expect, test } from "vitest";
import { lookupMimeType } from "#/http/mime-type";

describe("MIME type lookup", () => {
  test.each([
    ["report.txt", "text/plain"],
    ["index.html", "text/html"],
    ["photo.jpeg", "image/jpeg"],
    ["archive.zip", "application/zip"],
    ["document.pdf", "application/pdf"],
    [
      "spreadsheet.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["module.mjs", "application/javascript"],
    ["font.woff2", "font/woff2"],
    ["movie.mp4", "video/mp4"],
    ["app.webmanifest", "application/manifest+json"],
  ])("maps %s to %s", (fileName, expected) => {
    expect(lookupMimeType(fileName)).toBe(expected);
  });

  test("matches file extensions case-insensitively", () => {
    expect(lookupMimeType("PHOTO.JPEG")).toBe("image/jpeg");
  });

  test.each(["README", ".gitignore", "archive.", "data.unknown-extension"])(
    "returns undefined for unknown or missing extensions: %s",
    (fileName) => {
      expect(lookupMimeType(fileName)).toBeUndefined();
    },
  );
});
