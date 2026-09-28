import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { run } from "#scripts/process";
import {
  parseReleaseVersion,
  planRelease,
  versionFromReleaseTag,
} from "#scripts/release-policy";

const TAR_BLOCK_BYTES = 512;
const MAX_PACKAGE_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

const readTarString = (
  block: Buffer,
  offset: number,
  length: number,
): string => {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
};

const readTarSize = (block: Buffer): number => {
  const value = readTarString(block, 124, 12).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar entry size");
  const size = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size)) throw new Error("Invalid tar entry size");
  return size;
};

const readPackageManifest = (file: string): Record<string, unknown> => {
  const archive = gunzipSync(readFileSync(file), {
    maxOutputLength: MAX_PACKAGE_ARCHIVE_BYTES,
  });

  for (let offset = 0; offset + TAR_BLOCK_BYTES <= archive.length; ) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entry = prefix ? `${prefix}/${name}` : name;
    const size = readTarSize(header);
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error(`Truncated tarball: ${file}`);

    if (entry === "package/package.json") {
      if (size > MAX_PACKAGE_MANIFEST_BYTES) {
        throw new Error(`Package manifest is too large: ${file}`);
      }
      const manifest: unknown = JSON.parse(
        archive.subarray(dataStart, dataEnd).toString("utf8"),
      );
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Array.isArray(manifest)
      ) {
        throw new Error(`Invalid package manifest: ${file}`);
      }
      return manifest as Record<string, unknown>;
    }

    offset = dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }

  throw new Error(`Package manifest not found: ${file}`);
};

export interface PublishReleasePackagesOptions {
  root: string;
  registry: string;
  tag?: string;
  expectedSha?: string;
  dryRun?: boolean;
}

const resolveNpmCli = (): string => {
  const nodeDirectory = dirname(realpathSync(process.execPath));
  const candidates = [
    resolve(
      nodeDirectory,
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    resolve(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(nodeDirectory, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    try {
      const canonical = realpathSync(candidate);
      if (lstatSync(canonical).isFile()) return canonical;
    } catch {
      // Try the next layout used by supported Node installations.
    }
  }
  throw new Error(
    `Unable to locate npm-cli.js next to the current Node.js executable: ${process.execPath}`,
  );
};

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

export const publishReleasePackages = ({
  root,
  registry,
  tag,
  expectedSha,
  dryRun = false,
}: PublishReleasePackagesOptions): void => {
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

  if (tag && expectedSha) {
    throw new Error("Use --tag locally or --expected-sha in CI, not both");
  }

  let releaseTag = tag;
  if (expectedSha) {
    const metadataDirectory = join(root, "release-metadata");
    requireDirectory(metadataDirectory, "release-metadata");
    const sha = readMetadataFile(metadataDirectory, "sha");
    if (!/^[a-f0-9]{40}$/.test(sha) || sha !== expectedSha) {
      throw new Error(
        "Release metadata SHA does not match the expected build SHA",
      );
    }
    releaseTag = readMetadataFile(metadataDirectory, "tag");
  }

  if (!releaseTag) throw new Error("Supply --tag or --expected-sha");
  const version = versionFromReleaseTag(releaseTag);
  const { distTag } = parseReleaseVersion(version);
  const directory = join(root, "release-packages");
  requireDirectory(directory, "release-packages");

  const artifacts = readdirSync(directory)
    .filter((file) => file.endsWith(".tgz"))
    .map((name) => {
      const file = join(directory, name);
      if (!lstatSync(file).isFile())
        throw new Error(`Not a regular tarball: ${file}`);
      // Read only package/package.json; never extract or execute package contents.
      return { file, manifest: readPackageManifest(file) };
    });
  const plan = planRelease(artifacts, version);

  const npmCli = resolveNpmCli();
  const npmArgs = (args: string[]): string[] => [npmCli, ...args];
  const isAlreadyPublished = (name: string, file: string): boolean => {
    const result = spawnSync(
      process.execPath,
      npmArgs([
        "view",
        `${name}@${version}`,
        "dist.integrity",
        "--json",
        "--registry",
        registry,
      ]),
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

  if (dryRun) {
    for (const { manifest } of plan)
      console.log(`Would publish ${manifest.name}@${version} --tag ${distTag}`);
    return;
  }

  // Preflight every package before the first registry mutation.
  const pending = plan.filter(({ manifest, file }) => {
    if (!isAlreadyPublished(String(manifest.name), file)) return true;
    console.log(
      `Identical ${manifest.name}@${version} already published; skipping`,
    );
    return false;
  });
  for (const { file } of pending) {
    run(
      process.execPath,
      npmArgs([
        "publish",
        file,
        "--registry",
        registry,
        "--access",
        "public",
        "--ignore-scripts",
        "--tag",
        distTag,
      ]),
    );
  }
  console.log(
    `Release ${version} complete (${distTag}); ${pending.length} packages published`,
  );
};
