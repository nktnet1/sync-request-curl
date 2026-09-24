import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getPrebuildFilename,
  supportedPlatformKeys,
} from "#scripts/native-platform";

const root = resolve(import.meta.dirname, "..");
const prebuilds = join(root, "prebuilds");
const missing = supportedPlatformKeys.filter((platform) => {
  const path = join(prebuilds, getPrebuildFilename(platform));
  return !existsSync(path) || statSync(path).size === 0;
});

if (missing.length > 0) {
  throw new Error(`Missing native prebuilds: ${missing.join(", ")}`);
}

console.log(`Verified ${supportedPlatformKeys.length} native prebuilds.`);
