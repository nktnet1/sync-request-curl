import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import { publishReleasePackages } from "#scripts/release-publisher";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
const originalArgv = process.argv;
const writeTarball = (file: string, manifest: object): void => {
  const payload = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write("package/package.json", 0, "utf8");
  header.write(
    `${payload.length.toString(8).padStart(11, "0")}\0`,
    124,
    "ascii",
  );
  header[156] = "0".charCodeAt(0);
  const padding = Buffer.alloc((512 - (payload.length % 512)) % 512);
  writeFileSync(
    file,
    gzipSync(Buffer.concat([header, payload, padding, Buffer.alloc(1024)])),
  );
};

let rootDirectory: string | undefined;
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.resetModules();
  if (rootDirectory) rmSync(rootDirectory, { recursive: true, force: true });
  rootDirectory = undefined;
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
])("publisher orchestration: %s", (mode) => {
  rootDirectory = mkdtempSync(join(tmpdir(), "curl-release-test-"));
  const directory = join(rootDirectory, "release-packages");
  mkdirSync(directory);
  const version = mode === "stable" ? "5.0.0" : "5.0.0-beta.2";
  const names = [
    ...supportedPlatformKeys.map(getNativePackageName),
    "sync-request-curl",
  ];
  const filesByName = new Map<string, string>();
  for (const [index, name] of names.entries()) {
    const file = join(directory, `${index}.tgz`);
    writeTarball(file, {
      name,
      version: mode === "bad-manifest" && index === 0 ? "0.0.0" : version,
      optionalDependencies: Object.fromEntries(
        names.slice(0, -1).map((native) => [native, version]),
      ),
    });
    filesByName.set(name, file);
  }
  const calls: string[][] = [];
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
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
        const suffix = `@${version}`;
        const packageName = args[2].slice(0, -suffix.length);
        const file = filesByName.get(packageName);
        if (!file) throw new Error(`Missing fixture for ${packageName}`);
        return {
          status: 0,
          stdout: JSON.stringify(
            `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`,
          ),
        };
      }
      return { status: 1, stdout: '{"error":{"code":"E404"}}' };
    }
    expect(args[1]).toBe("publish");
    return { status: 0 };
  });

  const options = {
    root: rootDirectory,
    registry: "https://registry.npmjs.org",
    tag: `v${version}` as string | undefined,
    expectedSha: undefined as string | undefined,
    dryRun: mode === "dry-run",
  };
  if (mode === "bad-sha" || mode === "metadata") {
    const metadataDirectory = join(rootDirectory, "release-metadata");
    mkdirSync(metadataDirectory);
    writeFileSync(join(metadataDirectory, "sha"), "a".repeat(40));
    writeFileSync(join(metadataDirectory, "tag"), `v${version}`);
    options.tag = undefined;
    options.expectedSha = (mode === "bad-sha" ? "b" : "a").repeat(40);
  }

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const execute = () => publishReleasePackages(options);
  if (["different", "network", "bad-manifest", "bad-sha"].includes(mode)) {
    expect(execute).toThrow();
  } else {
    execute();
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
  if (["dry-run", "bad-manifest", "bad-sha"].includes(mode)) {
    expect(calls.filter(([command]) => command === "npm")).toHaveLength(0);
  }
});

test.each(["--directory=elsewhere", "--metadata=elsewhere"])(
  "publisher CLI rejects removed path option: %s",
  async (option) => {
    process.argv = [
      process.execPath,
      "publish-release-packages.ts",
      "--registry=https://registry.npmjs.org",
      option,
      "--tag=v5.0.0-beta.2",
    ];
    await expect(import("#scripts/publish-release-packages")).rejects.toThrow(
      /Unknown option/,
    );
  },
);
