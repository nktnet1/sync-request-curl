import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";

const argsSchema = v.object({
  file: v.string("--file must point to a native addon"),
});

const nativeBindingSchema = v.object({
  request: v.function("Native addon must export request()"),
});

const { values } = parseArgs({
  options: {
    file: { type: "string" },
  },
});
const { file: fileArgument } = v.parse(argsSchema, values);
const file = resolve(fileArgument);
if (!existsSync(file)) {
  throw new Error(`Native addon does not exist: ${file}`);
}

const nativeRequire = createRequire(import.meta.url);
v.parse(nativeBindingSchema, nativeRequire(file));

console.log(`Loaded native addon: ${file}`);
