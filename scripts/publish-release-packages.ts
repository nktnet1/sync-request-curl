import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { supportedPlatformKeys } from "#/native/platform-key-core";
import { run } from "#scripts/process";

const { values } = parseArgs({
  options: {
    directory: { type: "string", default: "release-packages" },
    registry: { type: "string" },
  },
});

const registry = values.registry;
if (!registry) {
  throw new Error(
    "--registry is required. Refusing to publish without an explicit registry.",
  );
}

const directory = resolve(values.directory);
const tarballs = readdirSync(directory)
  .filter((entry) => entry.endsWith(".tgz"))
  .map((entry) => join(directory, entry))
  .filter((path) => statSync(path).isFile());

const nativeTarballs = tarballs
  .filter((path) => basename(path).startsWith("nktnet-sync-request-curl-"))
  .sort();
const mainTarballs = tarballs.filter((path) =>
  basename(path).startsWith("sync-request-curl-"),
);

if (nativeTarballs.length !== supportedPlatformKeys.length) {
  throw new Error(
    `Expected ${supportedPlatformKeys.length} native release tarballs, found ${nativeTarballs.length}`,
  );
}
if (mainTarballs.length !== 1) {
  throw new Error(
    `Expected exactly one main release tarball, found ${mainTarballs.length}`,
  );
}

const publish = (tarball: string, accessPublic = false): void => {
  const args = ["publish", tarball, "--registry", registry, "--ignore-scripts"];
  if (accessPublic) {
    args.push("--access", "public");
  }
  run("npm", args);
};

for (const tarball of nativeTarballs) {
  publish(tarball, true);
}
publish(mainTarballs[0]);

console.log(
  `Published ${nativeTarballs.length} native packages and the main package to ${registry}`,
);
