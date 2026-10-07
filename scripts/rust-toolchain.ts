import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const toolchainPath = join(root, "rust-toolchain.toml");

export const getRustToolchain = (): string => {
  const contents = readFileSync(toolchainPath, "utf8");
  const match = /^\s*channel\s*=\s*"([^"]+)"\s*$/m.exec(contents);
  if (!match?.[1]) {
    throw new Error(`Missing Rust channel in ${toolchainPath}`);
  }
  return match[1];
};

export const getRustVersionLabel = (): string =>
  getRustToolchain().replace(/\.0$/, "");

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.write(`${getRustToolchain()}\n`);
}
