import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { styleText } from "node:util";
import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import { parseReleasePackageJson } from "#scripts/release/package";
import { run } from "#scripts/shared/process";

export const BOOTSTRAP_VERSION = "0.0.0-bootstrap.0";
export const BOOTSTRAP_TAG = "bootstrap";
export const bootstrapRoot = resolve(import.meta.dirname, "../..");
const packageJson = parseReleasePackageJson(
  readFileSync(join(bootstrapRoot, "package.json"), "utf8"),
);
export const bootstrapRepository = packageJson.repository;

export const status = (
  format: "cyan" | "green" | "yellow",
  text: string,
): string => styleText([format, "bold"], text);

const packageExists = (packageName: string, registry: string): boolean => {
  try {
    run(
      "pnpm",
      ["view", packageName, "versions", "--json", `--registry=${registry}`],
      { cwd: bootstrapRoot, capture: true },
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNotFound =
      /\b404\b/.test(message) &&
      /(not found|not in the npm registry|failed to fetch metadata)/i.test(
        message,
      );
    if (isNotFound) {
      return false;
    }
    throw new Error(
      `Unable to determine whether ${packageName} exists in ${registry}`,
      { cause: error },
    );
  }
};

const createBootstrapManifest = (
  packageName: string,
): Record<string, unknown> => ({
  name: packageName,
  version: BOOTSTRAP_VERSION,
  description:
    `Bootstrap placeholder for ${packageName}. ` +
    `Install ${packageJson.name} instead of depending on this package directly.`,
  repository: packageJson.repository,
  license: packageJson.license,
  author: packageJson.author,
  engines: packageJson.engines,
  files: ["README.md"],
  publishConfig: { access: "public" },
});

const publishBootstrapPackage = (
  packageName: string,
  registry: string,
  publish: boolean,
): void => {
  const directory = mkdtempSync(join(tmpdir(), "sync-request-curl-bootstrap-"));

  try {
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(createBootstrapManifest(packageName), null, 2)}\n`,
    );
    writeFileSync(
      join(directory, "README.md"),
      `# ${packageName}\n\n` +
        `Bootstrap placeholder for \`${packageName}\`. ` +
        `Install \`${packageJson.name}\` instead of depending on this package directly.\n`,
    );

    const args = [
      "publish",
      "--access",
      "public",
      "--tag",
      BOOTSTRAP_TAG,
      `--registry=${registry}`,
      "--no-git-checks",
      "--ignore-scripts",
    ];
    if (!publish) {
      args.push("--dry-run");
    }
    run("pnpm", args, { cwd: directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

interface PackageScanResult {
  names: string[];
  missing: string[];
  skipped: number;
}

export const scanPackages = (
  freebsdOnly: boolean,
  registry: string,
): PackageScanResult => {
  const names = supportedPlatformKeys
    .filter((platform) => !freebsdOnly || platform.startsWith("freebsd-"))
    .map(getNativePackageName);
  const missing: string[] = [];
  let skipped = 0;

  for (const packageName of names) {
    if (!packageExists(packageName, registry)) {
      missing.push(packageName);
      console.log(
        `${status("yellow", "CREATE")} ${packageName} does not exist`,
      );
      continue;
    }

    skipped += 1;
    console.log(`${status("green", "SKIP")} ${packageName} already exists`);
  }

  return { names, missing, skipped };
};

export interface BootstrapResult {
  published: number;
  skipped: number;
  validated: number;
}

export const bootstrapMissingPackages = (
  missing: string[],
  initialSkipped: number,
  registry: string,
  publish: boolean,
): BootstrapResult => {
  let published = 0;
  let skipped = initialSkipped;
  let validated = 0;

  for (const packageName of missing) {
    if (publish && packageExists(packageName, registry)) {
      skipped += 1;
      console.log(`${status("green", "SKIP")} ${packageName} now exists`);
      continue;
    }

    publishBootstrapPackage(packageName, registry, publish);
    if (publish) {
      published += 1;
      console.log(
        `${status("green", "PUBLISHED")} ${packageName}@${BOOTSTRAP_VERSION}`,
      );
      continue;
    }

    validated += 1;
    console.log(`${status("cyan", "DRY-RUN")} ${packageName} is publishable`);
  }

  return { published, skipped, validated };
};
