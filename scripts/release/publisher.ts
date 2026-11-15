import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseReleaseVersion,
  planRelease,
  versionFromReleaseTag,
} from "#scripts/release/policy";
import {
  type PublishContext,
  preflightRelease,
  publishWithRecovery,
  resolveNpmCli,
} from "#scripts/release/registry";
import { readPackageManifest } from "#scripts/release/tar";

export interface PublishReleasePackagesOptions {
  root: string;
  registry: string;
  tag?: string;
  expectedSha?: string;
  dryRun?: boolean;
}

const requireDirectory = (directory: string, label: string): void => {
  if (!lstatSync(directory).isDirectory()) {
    throw new Error(`${label} must be a regular directory`);
  }
};

const readMetadataFile = (
  metadataDirectory: string,
  filename: "sha" | "tag",
): string => {
  const file = join(metadataDirectory, filename);
  if (!lstatSync(file).isFile()) {
    throw new Error(`Release metadata ${filename} must be a regular file`);
  }
  return readFileSync(file, "utf8").trim();
};

const validateRegistry = (registry: string): void => {
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
};

const resolveReleaseTag = ({
  root,
  tag,
  expectedSha,
}: PublishReleasePackagesOptions): string => {
  if (tag && expectedSha) {
    throw new Error("Use --tag locally or --expected-sha in CI, not both");
  }
  if (tag) return tag;
  if (!expectedSha) throw new Error("Supply --tag or --expected-sha");

  const metadataDirectory = join(root, "release-metadata");
  requireDirectory(metadataDirectory, "release-metadata");
  const sha = readMetadataFile(metadataDirectory, "sha");
  if (!/^[a-f0-9]{40}$/.test(sha) || sha !== expectedSha) {
    throw new Error(
      "Release metadata SHA does not match the expected build SHA",
    );
  }
  return readMetadataFile(metadataDirectory, "tag");
};

const readReleaseArtifacts = (root: string) => {
  const directory = join(root, "release-packages");
  requireDirectory(directory, "release-packages");
  return readdirSync(directory)
    .filter((file) => file.endsWith(".tgz"))
    .map((name) => {
      const file = join(directory, name);
      if (!lstatSync(file).isFile())
        throw new Error(`Not a regular tarball: ${file}`);
      // Read only package/package.json; never extract or execute package contents.
      return { file, manifest: readPackageManifest(file) };
    });
};

const logDryRun = (
  plan: ReturnType<typeof planRelease>,
  version: string,
  distTag: string,
): void => {
  for (const { manifest } of plan) {
    console.log(`Would publish ${manifest.name}@${version} --tag ${distTag}`);
  }
};

export const publishReleasePackages = async (
  options: PublishReleasePackagesOptions,
): Promise<void> => {
  const { root, registry, dryRun = false } = options;
  validateRegistry(registry);
  const version = versionFromReleaseTag(resolveReleaseTag(options));
  const { distTag } = parseReleaseVersion(version);
  const plan = planRelease(readReleaseArtifacts(root), version);
  if (dryRun) {
    logDryRun(plan, version, distTag);
    return;
  }

  const context: PublishContext = {
    npmCli: resolveNpmCli(),
    registry,
    version,
  };
  // Preflight every package before the first registry mutation.
  const pending = await preflightRelease(context, plan);
  await pending.reduce<Promise<void>>(
    (previous, artifact) =>
      previous.then(() => publishWithRecovery(context, artifact, distTag)),
    Promise.resolve(),
  );
  console.log(
    `Release ${version} complete (${distTag}); ${pending.length} packages processed`,
  );
};
