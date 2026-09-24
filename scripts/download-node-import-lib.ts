import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "win32") {
  throw new Error("node.lib is only required for Windows native builds");
}
if (process.arch !== "x64" && process.arch !== "arm64") {
  throw new Error(`Unsupported Windows architecture: ${process.arch}`);
}

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "native", "build");
const output = join(outputDirectory, "node.lib");
const url =
  `https://nodejs.org/download/release/v${process.versions.node}/` +
  `win-${process.arch}/node.lib`;
const response = await fetch(url);
if (!response.ok) {
  throw new Error(
    `Unable to download node.lib: ${response.status} ${response.statusText}`,
  );
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(output, Buffer.from(await response.arrayBuffer()));
console.log(output);
