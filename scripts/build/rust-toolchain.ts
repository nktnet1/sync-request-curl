import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "../..");

// FreeBSD ARM64 needs a release with published rust-std artifacts.
export const freebsdArm64CrossRustToolchain = "1.100.0";

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

export const getRustToolchain = (projectRoot = root): string => {
  const toolchainPath = join(projectRoot, "rust-toolchain.toml");
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
  const toolchain =
    process.argv[2] === "--freebsd-arm64-cross"
      ? freebsdArm64CrossRustToolchain
      : getRustToolchain();
  process.stdout.write(`${toolchain}\n`);
}
