import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
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

const nativeRequire = createRequire(import.meta.url);
const binding: unknown = nativeRequire(file);
if (
  typeof binding !== "object" ||
  binding === null ||
  !("request" in binding) ||
  typeof binding.request !== "function"
) {
  throw new TypeError(`Native addon does not export request(): ${file}`);
}

console.log(`Loaded native addon: ${file}`);
