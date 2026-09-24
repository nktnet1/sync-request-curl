import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { LinuxLibc, NativePlatformKey } from "#scripts/native-platform";
import { getLinuxLibc, getPrebuildFilename } from "#scripts/native-platform";
import { run } from "#scripts/process";

const root = resolve(import.meta.dirname, "..");
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
    "--workdir",
    "/workspace",
  ];

  if (mode === "test") {
    dockerArgs.push(
      "--mount",
      "type=volume,destination=/workspace/node_modules",
      "--mount",
      "type=volume,destination=/workspace/native/build",
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
      "autoconf",
      "automake",
      "bash",
      "binutils",
      "build-base",
      "ca-certificates",
      "cmake",
      "curl",
      "git",
      "libtool",
      "linux-headers",
      "ninja",
      "perl",
      "pkgconf",
      "tar",
      "unzip",
      "zip",
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
    "autoconf",
    "automake",
    "binutils",
    "build-essential",
    "ca-certificates",
    "cmake",
    "curl",
    "git",
    "libtool",
    "ninja-build",
    "perl",
    "pkg-config",
    "tar",
    "unzip",
    "zip",
  ]);
};

const buildInsideContainer = (targetLibc: LinuxLibc): void => {
  if (process.platform !== "linux" || getLinuxLibc() !== targetLibc) {
    throw new Error(`Expected a ${targetLibc} Linux build container`);
  }

  const vcpkgRoot = join(root, ".vcpkg");
  const bootstrap = join(vcpkgRoot, "bootstrap-vcpkg.sh");
  if (!existsSync(bootstrap)) {
    throw new Error(
      ".vcpkg is missing; checkout microsoft/vcpkg before building",
    );
  }

  installBuildDependencies(targetLibc);
  const bootstrapArgs = ["-disableMetrics"];
  if (targetLibc === "musl") bootstrapArgs.push("-musl");
  const buildEnv = {
    ...process.env,
    VCPKG_FORCE_SYSTEM_BINARIES: targetLibc === "musl" ? "1" : undefined,
  };
  run(bootstrap, bootstrapArgs, { cwd: root, env: buildEnv });

  const architecture = getArchitecture();
  const triplet = `${architecture}-linux`;
  run(join(vcpkgRoot, "vcpkg"), ["install", `curl[http2]:${triplet}`], {
    cwd: root,
    env: buildEnv,
  });

  const cmakeEnv = {
    ...buildEnv,
    CMAKE_TOOLCHAIN_FILE: join(
      vcpkgRoot,
      "scripts",
      "buildsystems",
      "vcpkg.cmake",
    ),
    VCPKG_TARGET_TRIPLET: triplet,
  };
  run(process.execPath, ["scripts/build-native.ts", "--cmake"], {
    cwd: root,
    env: cmakeEnv,
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
