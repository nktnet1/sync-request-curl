import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseArgs, styleText } from "node:util";
import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import { run } from "#scripts/process";
import { parseReleasePackageJson } from "#scripts/release-package";

const BOOTSTRAP_VERSION = "0.0.0-bootstrap.0";
const BOOTSTRAP_TAG = "bootstrap";
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const OIDC_WORKFLOW = "publish.yaml";
const OIDC_ENVIRONMENT = "Production";
const MINIMUM_TRUST_NPM_VERSION = [11, 15, 0] as const;

const root = resolve(import.meta.dirname, "..");
const packageJson = parseReleasePackageJson(
  readFileSync(join(root, "package.json"), "utf8"),
);

export interface BootstrapOptions {
  publish?: boolean;
  registry?: string;
  freebsdOnly?: boolean;
  configureOidc?: boolean;
}

interface TrustConfiguration {
  type: string;
  file?: string;
  repository?: string;
  environment?: string;
  permissions?: string[];
}

const status = (format: "cyan" | "green" | "yellow", text: string): string =>
  styleText([format, "bold"], text);

const packageExists = (packageName: string, registry: string): boolean => {
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

const printHelp = (): void => {
  console.log(`Usage: pnpm bootstrap:native [--freebsd-only] [--configure-oidc] [--publish]

Bootstraps platform-specific @nktnet/sync-request-curl-* names. Already published
names are skipped regardless of their versions. --freebsd-only selects just
freebsd-arm64 and freebsd-x64.

Missing names receive a placeholder version ${BOOTSTRAP_VERSION} under the
non-default "${BOOTSTRAP_TAG}" dist-tag. No native binaries are required.

Default: check the registry and dry-run missing bootstrap packages.
--publish: publish missing packages (and apply OIDC when requested).
--configure-oidc: set up npm Trusted Publishing for ${OIDC_WORKFLOW} with the
  ${OIDC_ENVIRONMENT} environment and direct publish permission. Without --publish,
  show the planned OIDC configuration without changing npm settings.
--registry <url>: registry to inspect and publish to (default: npmjs.org).

OIDC setup requires npm >= 11.15, npm login with 2FA enabled, and write access
for the package names. If a captured trust lookup requires 2FA, the interactive
npm trust github command handles the browser challenge instead.
Publish a release via the trusted GitHub Actions workflow within 2 days of
creating a new trust relationship so npm can validate it.`);
};

interface PackageScanResult {
  names: string[];
  missing: string[];
  skipped: number;
}

const scanPackages = (
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

const ensurePublisherAuthentication = (
  registry: string,
  configureOidc: boolean,
): void => {
  const cli = configureOidc ? "npm" : "pnpm";
  try {
    const username = run(cli, ["whoami", `--registry=${registry}`], {
      cwd: root,
      capture: true,
    });
    console.log(`${status("cyan", "USER")} publishing as ${username}`);
  } catch {
    throw new Error(
      `Authenticate with ${cli} login --registry=${registry} before retrying. ` +
        (configureOidc
          ? "npm Trusted Publishing setup requires account 2FA."
          : ""),
    );
  }
};

const getGitHubRepository = (): string => {
  const repository = packageJson.repository;
  const value =
    typeof repository === "object" && repository !== null && "url" in repository
      ? repository.url
      : repository;
  if (typeof value !== "string") {
    throw new Error("package.json must specify its GitHub repository URL");
  }
  const match =
    /^(?:git\+)?https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      value,
    );
  if (!match) {
    throw new Error("package.json must specify a github.com/owner/repo URL");
  }
  return match[1];
};

const ensureOidcPrerequisites = (registry: string): string => {
  const url = new URL(registry);
  if (url.href !== DEFAULT_REGISTRY) {
    throw new Error(
      "npm trusted publishing requires https://registry.npmjs.org/",
    );
  }
  const version = run("npm", ["--version"], { cwd: root, capture: true });
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  const parts = match?.slice(1, 4).map(Number);
  const firstDifference = parts?.findIndex(
    (part, index) => part !== MINIMUM_TRUST_NPM_VERSION[index],
  );
  if (
    !parts ||
    (firstDifference !== undefined &&
      firstDifference !== -1 &&
      parts[firstDifference] < MINIMUM_TRUST_NPM_VERSION[firstDifference])
  ) {
    throw new Error(
      `npm trust requires npm >= 11.15.0; found ${version}. Update npm before continuing.`,
    );
  }
  return getGitHubRepository();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** npm 11 emits a separate JSON object for each trusted publisher, not an array. */
export const parseTrustedPublishers = (
  output: string,
): TrustConfiguration[] => {
  const input = output.trim();
  if (!input) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    // Support multiple pretty-printed JSON objects, with no delimiters.
    const values: unknown[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (start === -1) {
        if (/\s/.test(char)) continue;
        if (char !== "{") throw new Error("Invalid npm trust list JSON");
        start = i;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          values.push(JSON.parse(input.slice(start, i + 1)));
          start = -1;
        }
      }
      if (depth < 0) throw new Error("Invalid npm trust list JSON");
    }
    if (start !== -1 || depth !== 0) {
      throw new Error("Incomplete npm trust list JSON");
    }
    parsed = values;
  }

  const configs: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (
    !configs.every(
      (config) =>
        isRecord(config) &&
        typeof config.type === "string" &&
        (config.permissions === undefined ||
          (Array.isArray(config.permissions) &&
            config.permissions.every(
              (permission) => typeof permission === "string",
            ))),
    )
  ) {
    throw new Error("Unexpected npm trust list configuration format");
  }
  return configs as TrustConfiguration[];
};

const readTrustedPublishers = (
  packageName: string,
  registry: string,
): TrustConfiguration[] | undefined => {
  try {
    const output = run(
      "npm",
      ["trust", "list", packageName, "--json", `--registry=${registry}`],
      { cwd: root, capture: true },
    );
    return parseTrustedPublishers(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\bEOTP\b|one-time pass|two-factor|\b2FA\b|npm-otp/i.test(message)) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(
          `An interactive terminal is required to configure npm trusted publishers for ${packageName}. ` +
            "Run the bootstrap command from a terminal to complete browser 2FA.",
          { cause: error },
        );
      }
      // npm cannot complete browser 2FA when its output is captured. Do not
      // repeat the captured lookup: creation below uses inherited stdio and
      // lets `npm trust github` complete the authentication challenge.
      console.log(
        `${status("yellow", "2FA")} Unable to inspect trust for ${packageName}; ` +
          "npm trust github will authenticate interactively. " +
          "Select the 5-minute 2FA skip option when offered.",
      );
      return undefined;
    }
    throw new Error(
      `Unable to check npm trusted publishers for ${packageName}.`,
      { cause: error },
    );
  }
};

const isExpectedPublisher = (
  configuration: TrustConfiguration,
  repository: string,
): boolean =>
  configuration.type === "github" &&
  configuration.repository === repository &&
  configuration.file === OIDC_WORKFLOW &&
  configuration.environment === OIDC_ENVIRONMENT &&
  configuration.permissions?.includes("createPackage") === true;

const configureTrustedPublishers = async (
  names: string[],
  registry: string,
  repository: string,
): Promise<void> => {
  let created = 0;
  let skipped = 0;
  for (const packageName of names) {
    const configurations = readTrustedPublishers(packageName, registry);
    if (
      configurations?.some((config) => isExpectedPublisher(config, repository))
    ) {
      skipped++;
      console.log(
        `${status("green", "SKIP")} ${packageName} OIDC already configured`,
      );
      continue;
    }
    if (configurations && configurations.length > 0) {
      throw new Error(
        `${packageName} already has a different trusted publisher. ` +
          `Review npm trust list ${packageName} and resolve it manually; existing trust is never revoked automatically.`,
      );
    }

    if (created > 0) await setTimeout(2000);
    run(
      "npm",
      [
        "trust",
        "github",
        packageName,
        `--repo=${repository}`,
        `--file=${OIDC_WORKFLOW}`,
        `--env=${OIDC_ENVIRONMENT}`,
        "--allow-publish",
        "--yes",
        `--registry=${registry}`,
      ],
      { cwd: root },
    );
    created++;
    console.log(`${status("green", "TRUSTED")} ${packageName}`);
  }
  console.log(
    `${status("green", "OIDC")} ${created} configured, ${skipped} already configured`,
  );
};

interface BootstrapResult {
  published: number;
  skipped: number;
  validated: number;
}

const bootstrapMissingPackages = (
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

const printBootstrapSummary = (
  { published, skipped, validated }: BootstrapResult,
  publish: boolean,
  freebsdOnly: boolean,
  configureOidc: boolean,
): void => {
  if (publish) {
    console.log(
      `${status("green", "DONE")} ${published} published, ${skipped} already existed`,
    );
    return;
  }

  console.log(
    `${status("cyan", "READY")} ${validated} can be bootstrapped, ${skipped} already existed`,
  );
  const options = [
    freebsdOnly && "--freebsd-only",
    configureOidc && "--configure-oidc",
    "--publish",
  ].filter(Boolean);
  console.log(
    `Run pnpm bootstrap:native ${options.join(" ")} to apply this plan.`,
  );
};

export const bootstrapNativePackages = async ({
  publish = false,
  registry = DEFAULT_REGISTRY,
  freebsdOnly = false,
  configureOidc = false,
}: BootstrapOptions = {}): Promise<void> => {
  // Validate the OIDC requirements before any package is published.
  const repository = configureOidc
    ? ensureOidcPrerequisites(registry)
    : undefined;
  const { names, missing, skipped } = scanPackages(freebsdOnly, registry);

  if (publish && (missing.length > 0 || configureOidc)) {
    ensurePublisherAuthentication(registry, configureOidc);
  }
  if (missing.length === 0) {
    console.log(
      `${status("green", "DONE")} all ${skipped} selected native packages already exist`,
    );
  } else {
    const result = bootstrapMissingPackages(
      missing,
      skipped,
      registry,
      publish,
    );
    printBootstrapSummary(result, publish, freebsdOnly, configureOidc);
  }

  if (!configureOidc || !repository) return;
  if (!publish) {
    console.log(
      `${status("cyan", "OIDC PLAN")} configure ${names.length} packages for ` +
        `${repository} / ${OIDC_WORKFLOW} (environment: ${OIDC_ENVIRONMENT}, permission: publish)`,
    );
    console.log("Add --publish to apply OIDC settings (requires account 2FA).");
    return;
  }
  await configureTrustedPublishers(names, registry, repository);
};

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      publish: { type: "boolean", default: false },
      registry: { type: "string", default: DEFAULT_REGISTRY },
      "freebsd-only": { type: "boolean", default: false },
      "configure-oidc": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) printHelp();
  else {
    await bootstrapNativePackages({
      publish: values.publish,
      registry: values.registry,
      freebsdOnly: values["freebsd-only"],
      configureOidc: values["configure-oidc"],
    });
  }
}
