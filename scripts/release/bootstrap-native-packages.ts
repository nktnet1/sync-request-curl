import { parseArgs } from "node:util";
import {
  BOOTSTRAP_TAG,
  BOOTSTRAP_VERSION,
  type BootstrapResult,
  bootstrapMissingPackages,
  bootstrapRepository,
  bootstrapRoot,
  scanPackages,
  status,
} from "#scripts/release/bootstrap-native-operations";
import {
  configureTrustedPublishers,
  ensureOidcPrerequisites,
  OIDC_ENVIRONMENT,
  OIDC_WORKFLOW,
} from "#scripts/release/npm-trusted-publishers";
import { run } from "#scripts/shared/process";

export { parseTrustedPublishers } from "#scripts/release/npm-trusted-publishers";

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

export interface BootstrapOptions {
  publish?: boolean;
  registry?: string;
  freebsdOnly?: boolean;
  configureOidc?: boolean;
}

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

const ensurePublisherAuthentication = (
  registry: string,
  configureOidc: boolean,
): void => {
  const cli = configureOidc ? "npm" : "pnpm";
  try {
    const username = run(cli, ["whoami", `--registry=${registry}`], {
      cwd: bootstrapRoot,
      capture: true,
    });
    console.log(`${status("cyan", "USER")} publishing as ${username}`);
  } catch {
    const hint = configureOidc
      ? " npm Trusted Publishing setup requires account 2FA."
      : "";
    throw new Error(
      `Authenticate with ${cli} login --registry=${registry} before retrying.${hint}`,
    );
  }
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
    ? ensureOidcPrerequisites(registry, bootstrapRepository)
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
