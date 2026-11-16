import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { nextBetaVersion } from "#scripts/beta-version";
import { run } from "#scripts/process";
import { releaseLabel } from "#scripts/release/policy";

const { values } = parseArgs({
  options: {
    publish: { type: "boolean", default: false },
    base: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const releaseHelp = `Usage: pnpm release:beta [--base <version>] [--dry-run | --publish]

Default: continue the manifest's v5 beta series, update package.json, and run release checks.
--base: explicitly choose the stable v5 base for a new beta series, for example
        5.0.1 or v5.1.0. The command never guesses patch vs minor.
--dry-run: show the next version without changing files or running checks.
--publish: also commit package.json, create an annotated tag, and atomically
           push the current branch and tag to origin, triggering release CI.

Requires a clean Git checkout, Node 24.14+ or 26+, pnpm, Rust, and native build tools.
Release publishing runs in the Publish workflow on a trusted tag push.
Registry/network errors abort; they are never treated as an empty version list.
After a failed check, the version change remains available for inspection.
Run --publish from a clean checkout, not after an uncommitted preparation run.`;

const assertReleaseOptions = (): void => {
  if (values.publish && values["dry-run"])
    throw new Error("Choose either --publish or --dry-run");
};

const listPublishedVersions = (root: string): string[] => {
  const published: unknown = JSON.parse(
    run(
      "npm",
      [
        "view",
        "sync-request-curl",
        "versions",
        "--json",
        "--registry=https://registry.npmjs.org",
      ],
      { cwd: root, capture: true },
    ),
  );
  const versions = typeof published === "string" ? [published] : published;
  if (
    !Array.isArray(versions) ||
    !versions.every((version) => typeof version === "string")
  ) {
    throw new Error("Invalid npm version list");
  }
  return versions;
};

const readReleaseManifest = (
  manifestPath: string,
): { name: string; version: string } => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.name !== "sync-request-curl" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("Unexpected package manifest");
  }
  return manifest;
};

type GitCommand = (args: string[]) => string;

const selectReleaseVersion = (
  root: string,
  git: GitCommand,
  current: string,
): string => {
  const remoteTags = git(["ls-remote", "--tags", "--refs", "origin"])
    .split("\n")
    .map((line) => line.split("refs/tags/")[1] ?? "");
  return nextBetaVersion(
    current,
    listPublishedVersions(root),
    [...git(["tag", "--list"]).split("\n"), ...remoteTags],
    values.base,
  );
};

const runReleaseChecks = (
  root: string,
  manifestPath: string,
  manifest: { name: string; version: string },
  version: string,
): void => {
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: root });
  for (const check of [
    "build:native",
    "test:source-build",
    "typecheck",
    "check",
    "tc",
    "build",
    "docs:check",
  ]) {
    run("pnpm", [check], { cwd: root });
  }
};

interface PreparedRelease {
  root: string;
  git: GitCommand;
  manifestPath: string;
  branch: string;
  version: string;
  tag: string;
}

const publishPreparedRelease = ({
  root,
  git,
  manifestPath,
  branch,
  version,
  tag,
}: PreparedRelease): void => {
  // Do not accidentally include edits made by tools or a concurrent editor.
  const status = git(["status", "--porcelain"]);
  if (status !== "M package.json" && status !== " M package.json") {
    throw new Error(
      "Expected only package.json to change; review the worktree before publishing",
    );
  }
  if (JSON.parse(readFileSync(manifestPath, "utf8")).version !== version) {
    throw new Error("Package version changed during validation");
  }
  git(["add", "--", "package.json"]);
  git(["commit", "-m", version]);
  git(["tag", "-a", tag, "-m", tag]);
  run(
    "git",
    [
      "push",
      "--atomic",
      "origin",
      `HEAD:refs/heads/${branch}`,
      `refs/tags/${tag}`,
    ],
    { cwd: root },
  );
  console.log(`Pushed ${tag}. Wait for the Publish workflow to finish, then run:
  pnpm smoke:release-registry --registry=https://registry.npmjs.org --version=${version} --matrix

Consumer prebuilt: npm install sync-request-curl@${version}
Consumer source build (after installing without optional dependencies):
  npm exec --no -- sync-request-curl-build
  pnpm exec sync-request-curl-build
  yarn run sync-request-curl-build`);
};

const main = (): void => {
  if (values.help) {
    console.log(releaseHelp);
    return;
  }
  assertReleaseOptions();
  const root = resolve(import.meta.dirname, "..");
  const git: GitCommand = (args) =>
    run("git", args, { cwd: root, capture: true });
  if (git(["status", "--porcelain"])) {
    throw new Error(
      "Commit or stash existing changes before preparing a release",
    );
  }
  const branch = git(["symbolic-ref", "--short", "HEAD"]);
  const manifestPath = resolve(root, "package.json");
  const manifest = readReleaseManifest(manifestPath);
  const version = selectReleaseVersion(root, git, manifest.version);
  const tag = releaseLabel(version);
  console.log(`${manifest.version} -> ${version} (npm tag: beta)`);
  if (values["dry-run"]) return;

  runReleaseChecks(root, manifestPath, manifest, version);
  if (!values.publish) {
    console.log(
      `Prepared ${version}. Review package.json, commit, and tag the tested commit as ${tag}.`,
    );
    return;
  }
  publishPreparedRelease({ root, git, manifestPath, branch, version, tag });
};

main();
