import assert from "node:assert/strict";
import childProcess, {
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(
  new URL("../../native/build.mjs", import.meta.url),
);

const spawnResult = (
  status: number,
  stdout = "",
  stderr = "",
): SpawnSyncReturns<string> => ({
  pid: 1,
  output: [null, stdout, stderr],
  stdout,
  stderr,
  status,
  signal: null,
});

const mutableChildProcess = childProcess as {
  spawnSync: typeof childProcess.spawnSync;
};

const modes = [
  "success",
  "system",
  "macos-default",
  "cargo-failure",
  "load-failure",
  "musl",
  "windows-x86",
  "symlink",
] as const;

type Mode = (typeof modes)[number];

const targetForMode = (mode: Mode): string => {
  switch (mode) {
    case "musl":
      return "x86_64-unknown-linux-musl";
    case "macos-default":
      return "x86_64-apple-darwin";
    case "windows-x86":
      return "i686-pc-windows-msvc";
    default:
      return "x86_64-unknown-linux-gnu";
  }
};

const expectedFeatureForMode = (mode: Mode): string => {
  if (mode === "system") {
    return "system-curl";
  }
  if (mode === "windows-x86") {
    return "bundled-curl";
  }
  return "bundled-curl-http3";
};

const nativeLibraryName = (): string => {
  if (process.platform === "win32") {
    return "sync_request_curl_native.dll";
  }
  if (process.platform === "darwin") {
    return "libsync_request_curl_native.dylib";
  }
  return "libsync_request_curl_native.so";
};

const restoreEnvironmentVariable = (
  name: string,
  value: string | undefined,
): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

const createMockSpawn = (
  mode: Mode,
  target: string,
  native: string,
  output: string,
  commands: string[],
): typeof childProcess.spawnSync =>
  ((
    command: string,
    args: readonly string[] = [],
    options?: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string> => {
    commands.push(command);
    if (command === "rustc") {
      return spawnResult(0, `host: ${target}`);
    }
    if (command === "cargo") {
      assert.ok(args.includes("--locked"));
      assert.ok(args.includes("--no-default-features"));
      assert.equal(
        args.at(args.indexOf("--features") + 1),
        expectedFeatureForMode(mode),
      );
      assert.equal(options?.env?.CARGO_TARGET_DIR, join(native, "target"));

      const targetIndex = args.indexOf("--target");
      if (mode === "musl") {
        assert.equal(targetIndex, -1);
        assert.equal(options?.env?.CARGO_BUILD_TARGET, undefined);
        assert.equal(
          options?.env?.CARGO_ENCODED_RUSTFLAGS,
          "--cfg\x1ftest_build\x1f-C\x1ftarget-feature=-crt-static",
        );
      } else {
        assert.equal(args.at(targetIndex + 1), target);
      }

      if (mode === "cargo-failure") {
        return spawnResult(1);
      }
      const releaseDirectory =
        mode === "musl"
          ? join(native, "target", "release")
          : join(native, "target", target, "release");
      const artifact = join(releaseDirectory, nativeLibraryName());
      mkdirSync(dirname(artifact), { recursive: true });
      writeFileSync(artifact, "new addon");
      return spawnResult(0);
    }

    assert.equal(command, process.execPath);
    assert.equal(readFileSync(output, "utf8"), "previous addon");
    const candidate = args.at(-1);
    assert.ok(candidate);
    assert.equal(readFileSync(candidate, "utf8"), "new addon");
    return mode === "load-failure" ? spawnResult(1) : spawnResult(0);
  }) as typeof childProcess.spawnSync;

for (const mode of modes) {
  test(`source builder: ${mode}`, async () => {
    // ESM resolves symlinks, including macOS /var -> /private/var.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "curl-source-test-")));
    const native = join(root, "native");
    const output = join(native, "build", "sync_request_curl_native.node");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "previous addon");
    copyFileSync(source, join(native, "build.mjs"));
    let entryDirectory = native;
    if (mode === "symlink") {
      entryDirectory = join(root, "native-link");
      symlinkSync(
        native,
        entryDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    const target = targetForMode(mode);
    const originalSpawn = childProcess.spawnSync;
    const originalTarget = process.env.CARGO_BUILD_TARGET;
    const originalFlags = process.env.CARGO_ENCODED_RUSTFLAGS;
    const originalArgv = process.argv;
    process.env.CARGO_BUILD_TARGET = target;
    process.env.CARGO_ENCODED_RUSTFLAGS = "--cfg\x1ftest_build";
    process.argv =
      mode === "system"
        ? [process.execPath, source, "--libcurl=system"]
        : [process.execPath, source];
    const commands: string[] = [];
    const mockSpawn = createMockSpawn(mode, target, native, output, commands);
    mutableChildProcess.spawnSync = mockSpawn;
    syncBuiltinESMExports();
    try {
      const build = import(
        pathToFileURL(join(entryDirectory, "build.mjs")).href
      );
      if (mode.endsWith("failure")) {
        await assert.rejects(build, /failed/);
        assert.equal(readFileSync(output, "utf8"), "previous addon");
      } else {
        await build;
        assert.equal(readFileSync(output, "utf8"), "new addon");
      }
      assert.deepEqual(commands.slice(0, 2), ["rustc", "cargo"]);
    } finally {
      mutableChildProcess.spawnSync = originalSpawn;
      syncBuiltinESMExports();
      process.argv = originalArgv;
      restoreEnvironmentVariable("CARGO_BUILD_TARGET", originalTarget);
      restoreEnvironmentVariable("CARGO_ENCODED_RUSTFLAGS", originalFlags);
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("source builder CLI displays help without a compiler", () => {
  const result = childProcess.spawnSync(process.execPath, [source, "--help"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: sync-request-curl-build/);
  assert.match(result.stdout, /--libcurl=system/);
  assert.match(result.stdout, /--libcurl=bundled/);
  assert.match(result.stdout, /bundled libcurl on all targets/);
});

test("source builder CLI rejects unknown arguments before compiling", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [source, "--unknown"],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument/);
});

test("source builder CLI rejects invalid curl sources before compiling", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [source, "--libcurl=automatic"],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid --libcurl value/);
});
