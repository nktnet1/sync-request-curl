import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { styleText } from "node:util";
import { run } from "#scripts/shared/process";

export const OIDC_WORKFLOW = "publish.yaml";
export const OIDC_ENVIRONMENT = "Production";
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const MINIMUM_TRUST_NPM_VERSION = [11, 15, 0] as const;
const root = resolve(import.meta.dirname, "../..");

const status = (format: "cyan" | "green" | "yellow", text: string): string =>
  styleText([format, "bold"], text);

interface TrustConfiguration {
  type: string;
  file?: string;
  repository?: string;
  environment?: string;
  permissions?: string[];
}

const getGitHubRepository = (repository: unknown): string => {
  const value =
    typeof repository === "object" && repository !== null && "url" in repository
      ? repository.url
      : repository;
  if (typeof value !== "string") {
    throw new TypeError("package.json must specify its GitHub repository URL");
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

const isSupportedNpmVersion = (version: string): boolean => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return false;

  const parts = match.slice(1, 4).map(Number);
  const firstDifference = parts.findIndex(
    (part, index) => part !== MINIMUM_TRUST_NPM_VERSION[index],
  );
  return (
    firstDifference === -1 ||
    parts[firstDifference] > MINIMUM_TRUST_NPM_VERSION[firstDifference]
  );
};

export const ensureOidcPrerequisites = (
  registry: string,
  repository: unknown,
): string => {
  const url = new URL(registry);
  if (url.href !== DEFAULT_REGISTRY) {
    throw new Error(
      "npm trusted publishing requires https://registry.npmjs.org/",
    );
  }
  const version = run("npm", ["--version"], { cwd: root, capture: true });
  if (!isSupportedNpmVersion(version)) {
    throw new Error(
      `npm trust requires npm >= 11.15.0; found ${version}. Update npm before continuing.`,
    );
  }
  return getGitHubRepository(repository);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface JsonObjectScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

const advanceJsonObjectScan = (
  state: JsonObjectScanState,
  character: string,
): void => {
  if (state.inString) {
    if (state.escaped) state.escaped = false;
    else if (character === "\\") state.escaped = true;
    else if (character === '"') state.inString = false;
    return;
  }

  if (character === '"') state.inString = true;
  else if (character === "{") state.depth += 1;
  else if (character === "}") state.depth -= 1;
};

const findJsonObjectEnd = (input: string, start: number): number => {
  const state: JsonObjectScanState = {
    depth: 0,
    inString: false,
    escaped: false,
  };
  for (let index = start; index < input.length; index += 1) {
    advanceJsonObjectScan(state, input[index]);
    if (state.depth === 0) return index + 1;
  }
  throw new SyntaxError("Incomplete npm trust list JSON");
};

const skipJsonWhitespace = (input: string, start: number): number => {
  let index = start;
  while (index < input.length && /\s/.test(input[index])) index += 1;
  return index;
};

/** npm 11 can print adjacent JSON objects rather than a single JSON array. */
const parseAdjacentJsonObjects = (input: string): unknown[] => {
  const values: unknown[] = [];
  let index = 0;

  while (index < input.length) {
    index = skipJsonWhitespace(input, index);
    if (index === input.length) break;
    if (input[index] !== "{") {
      throw new SyntaxError("Invalid npm trust list JSON");
    }
    const end = findJsonObjectEnd(input, index);
    values.push(JSON.parse(input.slice(index, end)));
    index = end;
  }

  return values;
};

const isTrustConfiguration = (value: unknown): value is TrustConfiguration => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.permissions === undefined) return true;
  return (
    Array.isArray(value.permissions) &&
    value.permissions.every((permission) => typeof permission === "string")
  );
};

export const parseTrustedPublishers = (
  output: string,
): TrustConfiguration[] => {
  const input = output.trim();
  if (!input) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    parsed = parseAdjacentJsonObjects(input);
  }

  const configurations: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (!configurations.every(isTrustConfiguration)) {
    throw new TypeError("Unexpected npm trust list configuration format");
  }
  return configurations;
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
