import { resolve } from "node:path";
import { run } from "#scripts/shared/process";

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const MINIMUM_TRUST_NPM_VERSION = [11, 15, 0] as const;
const root = resolve(import.meta.dirname, "../..");

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
