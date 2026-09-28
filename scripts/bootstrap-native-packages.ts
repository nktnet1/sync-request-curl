import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, styleText } from "node:util";
import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import { run } from "#scripts/process";
import { parseReleasePackageJson } from "#scripts/release-package";

const BOOTSTRAP_VERSION = "0.0.0-bootstrap.0";
const BOOTSTRAP_TAG = "bootstrap";

const { values } = parseArgs({
  options: {
    publish: { type: "boolean", default: false },
    registry: {
      type: "string",
      default: "https://registry.npmjs.org/",
    },
    help: { type: "boolean", short: "h", default: false },
  },
});

const root = resolve(import.meta.dirname, "..");
const registry = values.registry;
const packageJson = parseReleasePackageJson(
  readFileSync(join(root, "package.json"), "utf8"),
);

const status = (format: "cyan" | "green" | "yellow", text: string): string =>
  styleText([format, "bold"], text);

const packageExists = (packageName: string): boolean => {
  try {
    run(
      "pnpm",
      ["view", packageName, "versions", "--json", `--registry=${registry}`],
      { cwd: root, capture: true },
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

const publishBootstrapPackage = (packageName: string): void => {
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
    if (!values.publish) {
      args.push("--dry-run");
    }
    run("pnpm", args, { cwd: directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const main = (): void => {
  if (values.help) {
    console.log(`Usage: pnpm bootstrap:native [--publish] [options]

Bootstraps only the platform-specific @nktnet/sync-request-curl-* package names.
Any package name that already exists in the registry is skipped, regardless of version.

Missing package names are created with the placeholder version ${BOOTSTRAP_VERSION}
and the non-default "${BOOTSTRAP_TAG}" dist-tag. No native binaries are required.

Default: check the registry and dry-run each missing bootstrap package.
--publish: create the missing packages for real.
--registry <url>: registry to inspect and publish to (default: npmjs.org).

After publishing, configure Trusted Publishing for each package, then let the normal
release workflow publish real beta/stable versions. Before --publish, authenticate
with pnpm login. If npm requires 2FA, pnpm will prompt for it.`);
    return;
  }

  const packages = supportedPlatformKeys.map(getNativePackageName);
  const missing: string[] = [];
  let skipped = 0;

  for (const packageName of packages) {
    if (packageExists(packageName)) {
      skipped += 1;
      console.log(`${status("green", "SKIP")} ${packageName} already exists`);
    } else {
      missing.push(packageName);
      console.log(
        `${status("yellow", "CREATE")} ${packageName} does not exist`,
      );
    }
  }

  if (missing.length === 0) {
    console.log(
      `${status("green", "DONE")} all ${skipped} native packages already exist`,
    );
    return;
  }

  if (values.publish) {
    const username = run("pnpm", ["whoami", `--registry=${registry}`], {
      cwd: root,
      capture: true,
    });
    console.log(`${status("cyan", "USER")} publishing as ${username}`);
  }

  let published = 0;
  let validated = 0;
  for (const packageName of missing) {
    if (values.publish && packageExists(packageName)) {
      skipped += 1;
      console.log(`${status("green", "SKIP")} ${packageName} now exists`);
      continue;
    }

    publishBootstrapPackage(packageName);
    if (values.publish) {
      published += 1;
      console.log(
        `${status("green", "PUBLISHED")} ${packageName}@${BOOTSTRAP_VERSION}`,
      );
    } else {
      validated += 1;
      console.log(`${status("cyan", "DRY-RUN")} ${packageName} is publishable`);
    }
  }

  if (values.publish) {
    console.log(
      `${status("green", "DONE")} ${published} published, ${skipped} already existed`,
    );
  } else {
    console.log(
      `${status("cyan", "READY")} ${validated} can be bootstrapped, ${skipped} already existed`,
    );
    console.log(
      "Run pnpm bootstrap:native --publish to create the missing packages.",
    );
  }
};

main();
