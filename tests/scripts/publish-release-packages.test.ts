import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
const originalArgv = process.argv;
const root = resolve(import.meta.dirname, "../..");
let directory: string;
let outsideDirectory: string;
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.resetModules();
  if (directory) rmSync(directory, { recursive: true, force: true });
  if (outsideDirectory)
    rmSync(outsideDirectory, { recursive: true, force: true });
});

test.each([
  "beta",
  "stable",
  "metadata",
  "dry-run",
  "retry",
  "different",
  "network",
  "bad-manifest",
  "bad-sha",
  "directory-traversal",
  "metadata-traversal",
])("publisher orchestration: %s", async (mode) => {
  directory = mkdtempSync(join(root, ".curl-release-test-"));
  const version = mode === "stable" ? "5.0.0" : "5.0.0-beta.2";
  const names = [
    ...supportedPlatformKeys.map(getNativePackageName),
    "sync-request-curl",
  ];
  const manifests = new Map<string, object>();
  for (const [index, name] of names.entries()) {
    const file = join(directory, `${index}.tgz`);
    writeFileSync(file, "test artifact");
    manifests.set(file, {
      name,
      version: mode === "bad-manifest" && index === 0 ? "0.0.0" : version,
      optionalDependencies: Object.fromEntries(
        names.slice(0, -1).map((native) => [native, version]),
      ),
    });
  }
  const calls: string[][] = [];
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
    if (command === "tar") {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify(manifests.get(args[1])) };
    }
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    calls.push(["npm", ...args.slice(1)]);
    if (args[1] === "view") {
      // Fail on the last lookup to prove earlier absent packages weren't published.
      if (args[2].startsWith("sync-request-curl@")) {
        if (mode === "network")
          return { status: 1, stdout: '{"error":{"code":"E503"}}' };
        if (mode === "different")
          return { status: 0, stdout: '"sha512-other"' };
      }
      if (mode === "retry") {
        return {
          status: 0,
          stdout: JSON.stringify(
            `sha512-${createHash("sha512").update("test artifact").digest("base64")}`,
          ),
        };
      }
      return { status: 1, stdout: '{"error":{"code":"E404"}}' };
    }
    expect(args[1]).toBe("publish");
    return { status: 0 };
  });
  process.argv = [
    process.execPath,
    "publish-release-packages.ts",
    "--registry=https://registry.npmjs.org",
    `--directory=${directory}`,
  ];
  if (mode === "directory-traversal") {
    outsideDirectory = mkdtempSync(join(tmpdir(), "curl-release-outside-"));
    process.argv[3] = `--directory=${outsideDirectory}`;
    process.argv.push(`--tag=v${version}`);
  } else if (mode === "metadata-traversal") {
    outsideDirectory = mkdtempSync(join(tmpdir(), "curl-release-outside-"));
    writeFileSync(join(outsideDirectory, "sha"), "a".repeat(40));
    writeFileSync(join(outsideDirectory, "tag"), `v${version}`);
    process.argv.push(
      `--metadata=${outsideDirectory}`,
      `--expected-sha=${"a".repeat(40)}`,
    );
  } else if (mode === "bad-sha" || mode === "metadata") {
    writeFileSync(join(directory, "sha"), "a".repeat(40));
    writeFileSync(join(directory, "tag"), `v${version}`);
    process.argv.push(
      `--metadata=${directory}`,
      `--expected-sha=${(mode === "bad-sha" ? "b" : "a").repeat(40)}`,
    );
  } else {
    process.argv.push(`--tag=v${version}`);
  }
  if (mode === "dry-run") process.argv.push("--dry-run");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const execute = import("#scripts/publish-release-packages");
  if (
    [
      "different",
      "network",
      "bad-manifest",
      "bad-sha",
      "directory-traversal",
      "metadata-traversal",
    ].includes(mode)
  ) {
    await expect(execute).rejects.toThrow();
  } else {
    await execute;
  }
  const publishes = calls.filter(
    ([command, action]) => command === "npm" && action === "publish",
  );
  if (["beta", "stable", "metadata"].includes(mode)) {
    expect(publishes).toHaveLength(names.length);
    expect(publishes.at(-1)?.[2]).toBe(
      join(directory, `${names.length - 1}.tgz`),
    );
    for (const command of publishes) {
      expect(command.slice(-2)).toEqual([
        "--tag",
        mode === "stable" ? "latest" : "beta",
      ]);
      expect(command).toContain("--ignore-scripts");
    }
  } else {
    expect(publishes).toHaveLength(0);
  }
  if (
    [
      "dry-run",
      "bad-manifest",
      "bad-sha",
      "directory-traversal",
      "metadata-traversal",
    ].includes(mode)
  ) {
    expect(calls.filter(([command]) => command === "npm")).toHaveLength(0);
  }
});
