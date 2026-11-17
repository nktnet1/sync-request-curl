import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { styleText } from "node:util";
import {
  parseTrustedPublishers,
  type TrustConfiguration,
} from "#scripts/release/npm-trust-output";
import { run } from "#scripts/shared/process";

export { parseTrustedPublishers } from "#scripts/release/npm-trust-output";
export { ensureOidcPrerequisites } from "#scripts/release/npm-trust-prerequisites";

export const OIDC_WORKFLOW = "publish.yaml";
export const OIDC_ENVIRONMENT = "Production";
const root = resolve(import.meta.dirname, "../..");

const status = (format: "cyan" | "green" | "yellow", text: string): string =>
  styleText([format, "bold"], text);

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
): boolean => {
  if (configuration.type !== "github") return false;
  if (configuration.repository !== repository) return false;
  if (configuration.file !== OIDC_WORKFLOW) return false;
  if (configuration.environment !== OIDC_ENVIRONMENT) return false;
  return configuration.permissions?.includes("createPackage") === true;
};

interface TrustSetupTotals {
  created: number;
  skipped: number;
}

const configureTrustedPublisher = async (
  packageName: string,
  registry: string,
  repository: string,
  totals: TrustSetupTotals,
): Promise<void> => {
  const configurations = readTrustedPublishers(packageName, registry);
  if (
    configurations?.some((config) => isExpectedPublisher(config, repository))
  ) {
    totals.skipped += 1;
    console.log(
      `${status("green", "SKIP")} ${packageName} OIDC already configured`,
    );
    return;
  }
  if (configurations && configurations.length > 0) {
    throw new Error(
      `${packageName} already has a different trusted publisher. ` +
        `Review npm trust list ${packageName} and resolve it manually; existing trust is never revoked automatically.`,
    );
  }

  if (totals.created > 0) await setTimeout(2_000);
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
  totals.created += 1;
  console.log(`${status("green", "TRUSTED")} ${packageName}`);
};

export const configureTrustedPublishers = async (
  names: string[],
  registry: string,
  repository: string,
): Promise<void> => {
  const totals: TrustSetupTotals = { created: 0, skipped: 0 };
  // Browser 2FA prompts and npm governance changes must run sequentially.
  await names.reduce<Promise<void>>(
    (previous, packageName) =>
      previous.then(() =>
        configureTrustedPublisher(packageName, registry, repository, totals),
      ),
    Promise.resolve(),
  );
  console.log(
    `${status("green", "OIDC")} ${totals.created} configured, ${totals.skipped} already configured`,
  );
};
