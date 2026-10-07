import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const toolchainPath = join(root, "rust-toolchain.toml");

const readQuotedValue = (line: string, key: string): string | undefined => {
  const separator = line.indexOf("=");
  if (separator === -1 || line.slice(0, separator).trim() !== key) {
    return undefined;
  }

  const value = line.slice(separator + 1).trim();
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return undefined;
  }
  return value.slice(1, -1);
};

export const getRustToolchain = (): string => {
  const contents = readFileSync(toolchainPath, "utf8");
  for (const line of contents.split("\n")) {
    const channel = readQuotedValue(line, "channel");
    if (channel) {
      return channel;
    }
  }
  throw new Error(`Missing Rust channel in ${toolchainPath}`);
};

export const getRustVersionLabel = (): string => {
  const toolchain = getRustToolchain();
  return toolchain.endsWith(".0") ? toolchain.slice(0, -2) : toolchain;
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.write(`${getRustToolchain()}\n`);
}
