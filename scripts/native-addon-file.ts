import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export function resolveNativeAddonFile(args?: string[]): string {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string" },
    },
  });

  if (!values.file) {
    throw new Error("--file must point to a native addon");
  }

  const file = resolve(values.file);
  if (!existsSync(file)) {
    throw new Error(`Native addon does not exist: ${file}`);
  }

  return file;
}
