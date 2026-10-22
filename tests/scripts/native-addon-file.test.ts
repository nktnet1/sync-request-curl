import { relative, resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveNativeAddonFile } from "#scripts/native-addon-file";

const existingFile = resolve(import.meta.dirname, "../../package.json");

test("requires a native addon path", () => {
  expect(() => resolveNativeAddonFile([])).toThrow(
    "--file must point to a native addon",
  );
  expect(() => resolveNativeAddonFile(["--file="])).toThrow(
    "--file must point to a native addon",
  );
});

test("rejects a missing native addon", () => {
  const missingFile = resolve(import.meta.dirname, "missing.node");
  expect(() => resolveNativeAddonFile(["--file", missingFile])).toThrow(
    `Native addon does not exist: ${missingFile}`,
  );
});

test("accepts absolute and relative file paths", () => {
  expect(resolveNativeAddonFile(["--file", existingFile])).toBe(existingFile);
  expect(
    resolveNativeAddonFile(["--file", relative(process.cwd(), existingFile)]),
  ).toBe(existingFile);
});

test("rejects unsupported CLI options", () => {
  expect(() => resolveNativeAddonFile(["--unknown"])).toThrow();
});
