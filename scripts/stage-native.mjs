import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const buildDirectory = join(root, "native", "build");
const outputDirectory = join(root, "prebuilds");

const getLinuxLibc = () => {
  const report = process.report?.getReport();
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
};

const getPlatformKey = () => {
  if (process.platform === "darwin") {
    return `darwin-${process.arch}`;
  }
  if (process.platform === "linux") {
    return `linux-${process.arch}-${getLinuxLibc()}`;
  }
  if (process.platform === "win32") {
    return `win32-${process.arch}-msvc`;
  }
  throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
};

const sourceCandidates = [
  join(buildDirectory, "sync_request_curl_native.node"),
  join(buildDirectory, "Release", "sync_request_curl_native.node"),
];
const source = sourceCandidates.find(existsSync);
if (!source) {
  throw new Error("Native addon has not been built. Run pnpm build:native first.");
}

mkdirSync(outputDirectory, { recursive: true });
const destination = join(
  outputDirectory,
  `sync_request_curl_native.${getPlatformKey()}.node`,
);
copyFileSync(source, destination);
console.log(destination);
