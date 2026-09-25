import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  getCurrentPlatformKey,
  getPrebuildFilename,
  parseNativePlatformKey,
} from "#scripts/native-platform";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "native", "build", "sync_request_curl_native.node");
const outputDirectory = join(root, "prebuilds");
const { values } = parseArgs({
  options: {
    platform: { type: "string" },
  },
});

const platform = values.platform
  ? parseNativePlatformKey(values.platform)
  : getCurrentPlatformKey();

if (!existsSync(source)) {
  throw new Error(
    "Native addon has not been built. Run pnpm build:native first.",
  );
}

mkdirSync(outputDirectory, { recursive: true });
const destination = join(outputDirectory, getPrebuildFilename(platform));
copyFileSync(source, destination);
console.log(destination);
