import { createRequire } from "node:module";

import { resolveNativeAddonFile } from "#scripts/native-addon-file";

const file = resolveNativeAddonFile();

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
