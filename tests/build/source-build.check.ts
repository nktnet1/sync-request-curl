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

for (const mode of [
  "success",
  "cargo-failure",
  "load-failure",
  "musl",
  "symlink",
] as const) {
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
    const target =
      mode === "musl"
        ? "x86_64-unknown-linux-musl"
        : "x86_64-unknown-linux-gnu";
    const originalSpawn = childProcess.spawnSync;
    const originalTarget = process.env.CARGO_BUILD_TARGET;
    const originalFlags = process.env.CARGO_ENCODED_RUSTFLAGS;
    process.env.CARGO_BUILD_TARGET = target;
    process.env.CARGO_ENCODED_RUSTFLAGS = "--cfg\x1ftest_build";
    const commands: string[] = [];
    const mockSpawn = (
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
        assert.equal(args.at(-1), target);
        assert.equal(options?.env?.CARGO_TARGET_DIR, join(native, "target"));
        if (mode === "musl") {
          assert.equal(
            options?.env?.CARGO_ENCODED_RUSTFLAGS,
            "--cfg\x1ftest_build\x1f-C\x1ftarget-feature=-crt-static",
          );
        }
        if (mode === "cargo-failure") {
          return spawnResult(1);
        }
        let name = "libsync_request_curl_native.so";
        if (process.platform === "win32") {
          name = "sync_request_curl_native.dll";
        } else if (process.platform === "darwin") {
          name = "libsync_request_curl_native.dylib";
        }
        const artifact = join(native, "target", target, "release", name);
        mkdirSync(dirname(artifact), { recursive: true });
        writeFileSync(artifact, "new addon");
      } else {
        assert.equal(command, process.execPath);
        assert.equal(readFileSync(output, "utf8"), "previous addon");
        const candidate = args.at(-1);
        assert.ok(candidate);
        assert.equal(readFileSync(candidate, "utf8"), "new addon");
        if (mode === "load-failure") {
          return spawnResult(1);
        }
      }
      return spawnResult(0);
    };
    mutableChildProcess.spawnSync = mockSpawn as typeof childProcess.spawnSync;
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
      if (originalTarget === undefined) {
        delete process.env.CARGO_BUILD_TARGET;
      } else {
        process.env.CARGO_BUILD_TARGET = originalTarget;
      }
      if (originalFlags === undefined) {
        delete process.env.CARGO_ENCODED_RUSTFLAGS;
      } else {
        process.env.CARGO_ENCODED_RUSTFLAGS = originalFlags;
      }
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
  assert.match(result.stderr, /Unknown arguments/);
});
