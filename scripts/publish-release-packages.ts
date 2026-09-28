import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { run } from "#scripts/process";
import {
  parseReleaseVersion,
  planRelease,
  versionFromReleaseTag,
} from "#scripts/release-policy";

const { values } = parseArgs({
  options: {
    registry: { type: "string" },
    directory: { type: "string" },
    tag: { type: "string" },
    metadata: { type: "string" },
    "expected-sha": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const registry = values.registry;
if (!registry) throw new Error("--registry is required");
const registryUrl = new URL(registry);
if (
  !["https:", "http:"].includes(registryUrl.protocol) ||
  registryUrl.username ||
  registryUrl.password
) {
  throw new Error(
    "Registry must be an HTTP(S) URL without embedded credentials",
  );
}
if (values.metadata && values.tag)
  throw new Error("Use --metadata or --tag, not both");
if (Boolean(values.metadata) !== Boolean(values["expected-sha"])) {
  throw new Error("--metadata and --expected-sha must be supplied together");
}
let tag = values.tag;
if (values.metadata) {
  const metadata = resolve(values.metadata);
  const sha = readFileSync(join(metadata, "sha"), "utf8").trim();
  if (!/^[a-f0-9]{40}$/.test(sha) || sha !== values["expected-sha"]) {
    throw new Error(
      "Release metadata SHA does not match the expected build SHA",
    );
  }
  tag = readFileSync(join(metadata, "tag"), "utf8").trim();
}
if (!tag) throw new Error("Supply --tag or --metadata with --expected-sha");
const version = versionFromReleaseTag(tag);
const { distTag } = parseReleaseVersion(version);
const directory = resolve(
  values.directory ?? resolve(import.meta.dirname, "..", "release-packages"),
);
const artifacts = readdirSync(directory)
  .filter((file) => file.endsWith(".tgz"))
  .map((name) => {
    const file = join(directory, name);
    if (!lstatSync(file).isFile())
      throw new Error(`Not a regular tarball: ${file}`);
    // Read only the manifest; never extract or execute package contents.
    const manifest: unknown = JSON.parse(
      run("tar", ["-xOf", file, "package/package.json"], { capture: true }),
    );
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error(`Invalid package manifest: ${file}`);
    }
    return { file, manifest: manifest as Record<string, unknown> };
  });
const plan = planRelease(artifacts, version);

const isAlreadyPublished = (name: string, file: string): boolean => {
  const result = spawnSync(
    "npm",
    [
      "view",
      `${name}@${version}`,
      "dist.integrity",
      "--json",
      "--registry",
      registry,
    ],
    {
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Only a structured E404 means absent; authentication/network failures abort.
    let errorCode: unknown;
    try {
      errorCode = JSON.parse(result.stdout || result.stderr)?.error?.code;
    } catch {
      // An unstructured failure is not proof that the version is absent.
    }
    if (result.status !== null && errorCode === "E404") return false;
    throw new Error(
      `Registry lookup failed for ${name}@${version}: ${result.stderr}`,
    );
  }
  const integrity: unknown = JSON.parse(result.stdout);
  const expected = `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;
  if (
    typeof integrity !== "string" ||
    !integrity.split(/\s+/).includes(expected)
  ) {
    throw new Error(
      `Published tarball differs from local artifact: ${name}@${version}`,
    );
  }
  return true;
};

if (values["dry-run"]) {
  for (const { manifest } of plan)
    console.log(`Would publish ${manifest.name}@${version} --tag ${distTag}`);
} else {
  // Preflight every package before the first registry mutation.
  const pending = plan.filter(({ manifest, file }) => {
    if (!isAlreadyPublished(String(manifest.name), file)) return true;
    console.log(
      `Identical ${manifest.name}@${version} already published; skipping`,
    );
    return false;
  });
  for (const { file } of pending) {
    run("npm", [
      "publish",
      file,
      "--registry",
      registry,
      "--access",
      "public",
      "--ignore-scripts",
      "--tag",
      distTag,
    ]);
  }
  console.log(
    `Release ${version} complete (${distTag}); ${pending.length} packages published`,
  );
}
