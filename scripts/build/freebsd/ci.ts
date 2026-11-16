import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRustToolchain } from "#scripts/build/rust-toolchain";
import { run } from "#scripts/shared/process";

export type FreebsdMode = "build" | "verify";
export type FreebsdPlatform = "freebsd-x64" | "freebsd-arm64";

const rustVersionAtLeast = (found: string, minimum: string): boolean => {
  const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
  const foundParts = found.match(versionPattern);
  const minimumParts = minimum.match(versionPattern);
  if (!foundParts || !minimumParts) return false;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(foundParts[index]) - Number(minimumParts[index]);
    if (difference !== 0) return difference > 0;
  }
  return true;
};

export interface FreebsdCiOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
}

/** Build or smoke-test a FreeBSD addon after the minimal shell bootstrap. */
export const runFreebsdCi = (
  mode: FreebsdMode,
  platform: FreebsdPlatform,
  options: FreebsdCiOptions = {},
): void => {
  const root = options.root ?? process.cwd();
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  env.PATH = `${env.HOME ?? "/root"}/.cargo/bin:${env.PATH ?? ""}:/usr/local/bin`;
  const execute = (command: string, args: string[], capture = false) =>
    run(command, args, { cwd: root, env, capture });

  const installedArch = execute("uname", ["-m"], true);
  if (installedArch !== "amd64" && installedArch !== "arm64") {
    throw new Error(`Unsupported FreeBSD architecture: ${installedArch}`);
  }
  const expectedPlatform =
    installedArch === "amd64" ? "freebsd-x64" : "freebsd-arm64";
  if (platform !== expectedPlatform) {
    throw new Error(`Expected platform ${expectedPlatform}, got ${platform}`);
  }

  const verifyNodePlatform = (): void => {
    const found = execute(
      "node",
      ["-p", 'process.platform + "-" + process.arch'],
      true,
    );
    if (found !== platform) {
      throw new Error(`Expected Node platform ${platform}, found ${found}`);
    }
  };

  if (mode === "build") {
    const required = getRustToolchain(root);
    if (installedArch === "amd64") {
      env.RUSTUP_TOOLCHAIN = required;
      const rustVersion = execute("rustc", ["--version"], true).split(/\s+/)[1];
      if (rustVersion !== required) {
        throw new Error(
          `FreeBSD amd64 requires Rust ${required}, found ${rustVersion}`,
        );
      }
    } else {
      delete env.RUSTUP_TOOLCHAIN;
      const installed =
        execute("rustc", ["--version"], true).split(/\s+/)[1] ?? "";
      if (!rustVersionAtLeast(installed, required)) {
        throw new Error(
          `FreeBSD arm64 requires Rust ${required} or newer; found ${installed}`,
        );
      }
    }
    for (const entry of readdirSync("/usr/local").sort()) {
      if (entry.startsWith("llvm")) {
        const directory = join("/usr/local", entry, "lib");
        if (existsSync(join(directory, "libclang.so"))) {
          env.LIBCLANG_PATH = directory;
          break;
        }
      }
    }
    verifyNodePlatform();
    execute("node", ["scripts/build/build-native.ts"]);
    execute("node", [
      "scripts/build/stage-native.ts",
      `--platform=${platform}`,
    ]);
  }

  verifyNodePlatform();
  const addon = `prebuilds/sync_request_curl_native.${platform}.node`;
  execute("node", ["scripts/build/verify-native-load.ts", `--file=${addon}`]);
  execute("node", ["scripts/build/verify-native-http.ts", `--file=${addon}`]);
  if (execute("ldd", [addon], true).includes("/usr/local/")) {
    throw new Error(
      "FreeBSD addon has unexpected runtime dependencies under /usr/local",
    );
  }

  if (mode === "build") {
    rmSync(join(root, "native/target"), { recursive: true, force: true });
    rmSync(join(root, "native/build"), { recursive: true, force: true });
  }
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const mode = process.argv[2];
  const platform = process.argv[3];
  if (
    (mode !== "build" && mode !== "verify") ||
    (platform !== "freebsd-x64" && platform !== "freebsd-arm64")
  ) {
    throw new Error(
      "Usage: node scripts/build/freebsd/ci.ts build|verify freebsd-x64|freebsd-arm64",
    );
  }
  runFreebsdCi(mode, platform);
}
