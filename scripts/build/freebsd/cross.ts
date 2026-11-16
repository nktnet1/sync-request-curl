import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "#scripts/shared/process";

const release = "14.4";
const target = "aarch64-unknown-freebsd";
const checksum =
  "c456bf75ee3d0b4da0b0b527402b0a9e61497f02756b2cc5801b51e80b3f90c4";

/** Turn absolute FreeBSD links into links rooted in the extracted sysroot. */
const rewriteSysrootLinks = (sysroot: string, directory = sysroot): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteSysrootLinks(sysroot, path);
    } else if (entry.isSymbolicLink()) {
      const destination = readlinkSync(path);
      if (isAbsolute(destination)) {
        const targetPath = resolve(sysroot, `.${destination}`);
        unlinkSync(path);
        symlinkSync(relative(dirname(path), targetPath), path);
      }
    }
  }
};

const prepareSysroot = (sysroot: string, env: NodeJS.ProcessEnv): void => {
  if (existsSync(join(sysroot, ".complete"))) return;
  const temporary = mkdtempSync(join(tmpdir(), "freebsd-arm64-base-"));
  const archive = join(temporary, "base.txz");
  try {
    mkdirSync(sysroot, { recursive: true });
    run(
      "curl",
      [
        "--fail",
        "--location",
        "--retry",
        "3",
        "--silent",
        "--show-error",
        "--output",
        archive,
        `https://download.freebsd.org/releases/arm64/${release}-RELEASE/base.txz`,
      ],
      { env },
    );
    const actualChecksum = run("sha256sum", [archive], {
      env,
      capture: true,
    }).split(/\s+/)[0];
    if (actualChecksum !== checksum) {
      throw new Error("FreeBSD 14.4 ARM64 base.txz checksum mismatch");
    }
    run("tar", ["-xJf", archive, "-C", sysroot], { env });
    if (
      !existsSync(join(sysroot, "usr/include/sys/types.h")) ||
      !existsSync(join(sysroot, "usr/lib"))
    ) {
      throw new Error("Incomplete FreeBSD ARM64 sysroot");
    }
    rewriteSysrootLinks(sysroot);
    writeFileSync(join(sysroot, ".complete"), "");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

export interface FreebsdCrossBuildOptions {
  root?: string;
  sysroot?: string;
  env?: NodeJS.ProcessEnv;
}

/** Build a FreeBSD ARM64 shared addon on Linux using the official sysroot. */
export const crossBuildFreebsdArm64 = (
  options: FreebsdCrossBuildOptions = {},
): void => {
  const root = options.root ?? resolve(import.meta.dirname, "../../..");
  const inheritedEnv = options.env ?? process.env;
  const sysroot =
    options.sysroot ??
    inheritedEnv.FREEBSD_CROSS_SYSROOT ??
    join(
      inheritedEnv.RUNNER_TEMP ?? tmpdir(),
      `freebsd-${release}-arm64-sysroot`,
    );
  prepareSysroot(sysroot, inheritedEnv);

  const compilerDirectory = join(root, "scripts/build/freebsd");
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnv,
    FREEBSD_CROSS_SYSROOT: sysroot,
    CARGO_BUILD_TARGET: target,
    CARGO_TARGET_AARCH64_UNKNOWN_FREEBSD_LINKER: join(
      compilerDirectory,
      "cc.sh",
    ),
    CC_aarch64_unknown_freebsd: join(compilerDirectory, "cc.sh"),
    CXX_aarch64_unknown_freebsd: join(compilerDirectory, "cxx.sh"),
    AR_aarch64_unknown_freebsd: "llvm-ar-18",
    RANLIB_aarch64_unknown_freebsd: "llvm-ranlib-18",
    AR: "llvm-ar-18",
    RANLIB: "llvm-ranlib-18",
    CMAKE_TOOLCHAIN_FILE: join(compilerDirectory, "toolchain.cmake"),
    LIBCLANG_PATH: "/usr/lib/llvm-18/lib",
    BINDGEN_EXTRA_CLANG_ARGS: `--target=aarch64-unknown-freebsd${release} --sysroot=${sysroot}`,
    LIBZ_SYS_STATIC: "1",
    OPENSSL_STATIC: "1",
    PKG_CONFIG_ALL_STATIC: "1",
    PKG_CONFIG_ALLOW_CROSS: "1",
    PKG_CONFIG_SYSROOT_DIR: sysroot,
    PKG_CONFIG_LIBDIR: `${sysroot}/usr/libdata/pkgconfig:${sysroot}/usr/lib/pkgconfig`,
  };
  run(
    "cargo",
    [
      "build",
      "--locked",
      "--manifest-path",
      "native/Cargo.toml",
      "--release",
      "--target",
      target,
      "--no-default-features",
      "--features",
      "bundled-curl-http3",
    ],
    { cwd: root, env },
  );

  const library = join(
    root,
    "native/target",
    target,
    "release/libsync_request_curl_native.so",
  );
  const header = run("readelf", ["-h", library], {
    cwd: root,
    env,
    capture: true,
  });
  if (
    !/\bType:\s+DYN\b/.test(header) ||
    !/\bMachine:\s+AArch64\b/.test(header)
  ) {
    throw new Error("Cross-built addon is not an AArch64 shared library");
  }
  const artifact = join(
    root,
    "prebuilds/sync_request_curl_native.freebsd-arm64.node",
  );
  mkdirSync(dirname(artifact), { recursive: true });
  copyFileSync(library, artifact);
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  crossBuildFreebsdArm64();
}
