import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const prebuilds = join(root, "prebuilds");
const required = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "win32-arm64-msvc",
  "win32-x64-msvc",
];

const missing = required.filter(
  (platform) =>
    !existsSync(join(prebuilds, `sync_request_curl_native.${platform}.node`)),
);

if (missing.length > 0) {
  throw new Error(`Missing native prebuilds: ${missing.join(", ")}`);
}
