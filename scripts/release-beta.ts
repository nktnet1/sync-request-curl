import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { nextBetaVersion } from "#scripts/beta-version";
import { run } from "#scripts/process";
import { releaseLabel } from "#scripts/release-policy";

const { values } = parseArgs({
  options: {
    publish: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const main = (): void => {
  if (values.help) {
    console.log(`Usage: pnpm release:beta [--dry-run | --publish]

Default: select the next v5 beta, update package.json, and run release checks.
--dry-run: show the next version without changing files or running checks.
--publish: also commit package.json, create an annotated tag, and atomically
           push the current branch and tag to origin, triggering release CI.

Requires a clean Git checkout, Node 24.14+ or 26+, pnpm, Rust, and native build tools.
Merge the beta-safe publish.yaml into the default branch before publishing.
Registry/network errors abort; they are never treated as an empty version list.
After a failed check, the version change remains available for inspection.
Run --publish from a clean checkout, not after an uncommitted preparation run.`);
    return;
  }
  if (values.publish && values["dry-run"]) {
    throw new Error("Choose either --publish or --dry-run");
  }
  const root = resolve(import.meta.dirname, "..");
  const git = (args: string[]): string =>
    run("git", args, { cwd: root, capture: true });
  if (git(["status", "--porcelain"])) {
    throw new Error(
      "Commit or stash existing changes before preparing a release",
    );
  }
  const branch = git(["symbolic-ref", "--short", "HEAD"]);
  const manifestPath = resolve(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.name !== "sync-request-curl" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("Unexpected package manifest");
  }
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
  const remoteTags = git(["ls-remote", "--tags", "--refs", "origin"])
    .split("\n")
    .map((line) => line.split("refs/tags/")[1] ?? "");
  const version = nextBetaVersion(manifest.version, versions, [
    ...git(["tag", "--list"]).split("\n"),
    ...remoteTags,
  ]);
  const tag = releaseLabel(version);
  console.log(`${manifest.version} -> ${version} (npm tag: beta)`);
  if (values["dry-run"]) return;

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
  if (!values.publish) {
    console.log(
      `Prepared ${version}. Review package.json, commit, and tag the tested commit as ${tag}.`,
    );
    return;
  }
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
  git(["commit", "-m", tag]);
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
  console.log(`Pushed ${tag}. Wait for Native prebuilds and Publish to finish, then run:
  pnpm smoke:release-registry --registry=https://registry.npmjs.org --version=${version} --matrix

Consumer prebuilt: npm install sync-request-curl@${version}
Consumer source build (after installing without optional dependencies):
  npm exec --no -- sync-request-curl-build
  pnpm exec sync-request-curl-build
  yarn run sync-request-curl-build`);
};

main();
