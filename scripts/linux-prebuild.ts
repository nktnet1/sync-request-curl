import { existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { LinuxLibc, NativePlatformKey } from "#scripts/native-platform";
import { getLinuxLibc, getPrebuildFilename } from "#scripts/native-platform";
import { run } from "#scripts/process";

const root = resolve(import.meta.dirname, "..");
const rustToolchain = "1.88.0";
// Bullseye LTS ended on 2026-08-31. Pin the last complete archive so
// security mirror cleanup cannot make an otherwise reproducible build fail.
const bullseyeSnapshot = "20260901T000000Z";

const getBullseyeAptArgs = (): string[] => {
  const sourceList = join(tmpdir(), "sync-request-curl-bullseye.list");
  writeFileSync(
    sourceList,
    [
      `deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/${bullseyeSnapshot}/ bullseye main`,
      `deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/${bullseyeSnapshot}/ bullseye-security main`,
      "",
    ].join("\n"),
  );

  return [
    "-o",
    `Dir::Etc::sourcelist=${sourceList}`,
    "-o",
    "Dir::Etc::sourceparts=-",
    "-o",
    "APT::Get::List-Cleanup=0",
    "-o",
    "Acquire::Check-Valid-Until=false",
    "-o",
    "Acquire::Retries=5",
  ];
};

const { values } = parseArgs({
  options: {
    libc: { type: "string" },
    mode: { type: "string", default: "build" },
    node: { type: "string", default: "22" },
    inside: { type: "boolean", default: false },
  },
});

const libc = values.libc;
const mode = values.mode ?? "build";
const nodeVersion = values.node ?? "22";
if (libc !== "gnu" && libc !== "musl") {
  throw new Error("--libc must be either gnu or musl");
}
if (mode !== "build" && mode !== "test") {
  throw new Error("--mode must be either build or test");
}

type Architecture = "x64" | "arm64";
const getArchitecture = (): Architecture => {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  throw new Error(`Unsupported Linux architecture: ${process.arch}`);
};

const getPlatform = (targetLibc: LinuxLibc): NativePlatformKey =>
  `linux-${getArchitecture()}-${targetLibc}`;

const imageFor = (targetLibc: LinuxLibc, nodeVersion: string): string =>
  `node:${nodeVersion}-${targetLibc === "musl" ? "alpine" : "bullseye"}`;

const runInContainer = (): void => {
  const dockerArgs = [
    "run",
    "--rm",
    "--volume",
    `${root}:/workspace`,
    "--mount",
    "type=volume,destination=/workspace/native/build",
    "--mount",
    "type=volume,destination=/workspace/native/target",
    "--workdir",
    "/workspace",
  ];

  if (mode === "test") {
    dockerArgs.push(
      "--mount",
      "type=volume,destination=/workspace/node_modules",
    );
  }

  dockerArgs.push(
    imageFor(libc, nodeVersion),
    "node",
    "scripts/linux-prebuild.ts",
    "--inside",
    `--libc=${libc}`,
    `--mode=${mode}`,
    `--node=${nodeVersion}`,
  );
  run("docker", dockerArgs, { cwd: root });
};

const installBuildDependencies = (targetLibc: LinuxLibc): void => {
  if (targetLibc === "musl") {
    run("apk", [
      "add",
      "--no-cache",
      "bash",
      "binutils",
      "build-base",
      "ca-certificates",
      "curl",
      "linux-headers",
      "perl",
      "pkgconf",
    ]);
    return;
  }

  const aptArgs = getBullseyeAptArgs();
  run("apt-get", [...aptArgs, "update"]);
  run("apt-get", [
    ...aptArgs,
    "install",
    "-y",
    "--no-install-recommends",
    "binutils",
    "build-essential",
    "ca-certificates",
    "curl",
    "perl",
    "pkg-config",
  ]);
};

const installRust = (): NodeJS.ProcessEnv => {
  const installer = join(tmpdir(), "rustup-init.sh");
  run("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "https://sh.rustup.rs",
    "--output",
    installer,
  ]);
  run("sh", [
    installer,
    "-y",
    "--profile",
    "minimal",
    "--default-toolchain",
    rustToolchain,
    "--no-modify-path",
  ]);

  const cargoHome = join(homedir(), ".cargo");
  return {
    ...process.env,
    PATH: `${join(cargoHome, "bin")}:${process.env.PATH ?? ""}`,
  };
};

const buildInsideContainer = (targetLibc: LinuxLibc): void => {
  if (process.platform !== "linux" || getLinuxLibc() !== targetLibc) {
    throw new Error(`Expected a ${targetLibc} Linux build container`);
  }

  installBuildDependencies(targetLibc);
  const buildEnv = installRust();
  run(process.execPath, ["scripts/build-native.ts"], {
    cwd: root,
    env: buildEnv,
  });

  const platform = getPlatform(targetLibc);
  run(process.execPath, ["scripts/stage-native.ts", `--platform=${platform}`], {
    cwd: root,
  });

  const prebuild = join(root, "prebuilds", getPrebuildFilename(platform));
  const verifyArgs = [
    "scripts/verify-native-deps.ts",
    `--file=${prebuild}`,
    `--libc=${targetLibc}`,
  ];
  if (targetLibc === "gnu") verifyArgs.push("--glibc-max=2.31");
  run(process.execPath, verifyArgs, { cwd: root });
  run(
    process.execPath,
    ["scripts/verify-native-load.ts", `--file=${prebuild}`],
    { cwd: root },
  );
};

const testInsideContainer = (targetLibc: LinuxLibc): void => {
  if (process.platform !== "linux" || getLinuxLibc() !== targetLibc) {
    throw new Error(`Expected a ${targetLibc} Linux test container`);
  }

  const platform = getPlatform(targetLibc);
  const prebuild = join(root, "prebuilds", getPrebuildFilename(platform));
  if (!existsSync(prebuild)) {
    throw new Error(`Missing prebuild for container test: ${prebuild}`);
  }

  run("npm", ["install", "--global", "pnpm@12.4.2"]);
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: root });
  run("pnpm", ["test"], { cwd: root });
};

if (!values.inside) runInContainer();
else if (mode === "build") buildInsideContainer(libc);
else testInsideContainer(libc);
