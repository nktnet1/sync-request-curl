import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

for (const mode of ["success", "cargo-failure", "load-failure", "musl"]) {
  test(`source builder: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "curl-source-test-"));
    const native = join(root, "native");
    const output = join(native, "build", "sync_request_curl_native.node");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "previous addon");
    copyFileSync(source, join(native, "build.mjs"));
    const target =
      mode === "musl"
        ? "x86_64-unknown-linux-musl"
        : "x86_64-unknown-linux-gnu";
    const originalSpawn = childProcess.spawnSync;
    const originalTarget = process.env.CARGO_BUILD_TARGET;
    const originalFlags = process.env.CARGO_ENCODED_RUSTFLAGS;
    process.env.CARGO_BUILD_TARGET = target;
    process.env.CARGO_ENCODED_RUSTFLAGS = "--cfg\x1ftest_build";
    const commands = [];
    childProcess.spawnSync = (command, args, options) => {
      commands.push(command);
      if (command === "rustc") return { status: 0, stdout: `host: ${target}` };
      if (command === "cargo") {
        assert.ok(args.includes("--locked"));
        assert.equal(args.at(-1), target);
        assert.equal(options.env.CARGO_TARGET_DIR, join(native, "target"));
        if (mode === "musl") {
          assert.equal(
            options.env.CARGO_ENCODED_RUSTFLAGS,
            "--cfg\x1ftest_build\x1f-C\x1ftarget-feature=-crt-static",
          );
        }
        if (mode === "cargo-failure") return { status: 1 };
        const name =
          process.platform === "win32"
            ? "sync_request_curl_native.dll"
            : process.platform === "darwin"
              ? "libsync_request_curl_native.dylib"
              : "libsync_request_curl_native.so";
        const artifact = join(native, "target", target, "release", name);
        mkdirSync(dirname(artifact), { recursive: true });
        writeFileSync(artifact, "new addon");
      } else {
        assert.equal(command, process.execPath);
        assert.equal(readFileSync(output, "utf8"), "previous addon");
        assert.equal(readFileSync(args.at(-1), "utf8"), "new addon");
        if (mode === "load-failure") return { status: 1 };
      }
      return { status: 0 };
    };
    syncBuiltinESMExports();
    try {
      const build = import(pathToFileURL(join(native, "build.mjs")).href);
      if (mode.endsWith("failure")) {
        await assert.rejects(build, /failed/);
        assert.equal(readFileSync(output, "utf8"), "previous addon");
      } else {
        await build;
        assert.equal(readFileSync(output, "utf8"), "new addon");
      }
      assert.deepEqual(commands.slice(0, 2), ["rustc", "cargo"]);
    } finally {
      childProcess.spawnSync = originalSpawn;
      syncBuiltinESMExports();
      if (originalTarget === undefined) delete process.env.CARGO_BUILD_TARGET;
      else process.env.CARGO_BUILD_TARGET = originalTarget;
      if (originalFlags === undefined)
        delete process.env.CARGO_ENCODED_RUSTFLAGS;
      else process.env.CARGO_ENCODED_RUSTFLAGS = originalFlags;
      rmSync(root, { recursive: true, force: true });
    }
  });
}
