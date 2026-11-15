import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { styleText } from "node:util";
import type { ReleaseArtifact } from "#scripts/release/policy";
import type { PublishContext } from "#scripts/release/registry";

const npmArgs = (npmCli: string, args: string[]): string[] => [npmCli, ...args];

const MAX_REGISTRY_LOOKUPS = 3;
const MAX_PUBLICATION_CHECKS = 3;
export const retryableNpmError =
  /\b(?:E408|E429|E500|E502|E503|E504|EAI_AGAIN|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE)\b/;

export const retryDelay = (attempt: number): number => attempt * 2_000;

/** Fail closed on anything other than a structured npm E404. */
const isAlreadyPublished = (
  { npmCli, registry, version }: PublishContext,
  { file, manifest }: ReleaseArtifact,
): boolean => {
  const name = String(manifest.name);
  const result = spawnSync(
    process.execPath,
    npmArgs(npmCli, [
      "view",
      `${name}@${version}`,
      "dist.integrity",
      "--json",
      "--prefer-online",
      "--fetch-retries=0",
      "--registry",
      registry,
    ]),
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let code: unknown;
    try {
      code = JSON.parse(result.stdout || result.stderr)?.error?.code;
    } catch {
      // An unstructured failure is not proof that the version is absent.
    }
    if (code === "E404") return false;
    const detail = result.stderr || result.stdout || `exit ${result.status}`;
    throw new Error(`Registry lookup failed for ${name}@${version}: ${detail}`);
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

/** Retry read-only registry checks, not uncertain publish mutations. */
export const checkPublished = async (
  context: PublishContext,
  artifact: ReleaseArtifact,
  attempt = 1,
): Promise<boolean> => {
  try {
    return isAlreadyPublished(context, artifact);
  } catch (error) {
    if (
      attempt >= MAX_REGISTRY_LOOKUPS ||
      !retryableNpmError.test(String(error))
    ) {
      throw error;
    }
    console.warn(
      `${styleText("yellow", "RETRY")} registry check for ${artifact.manifest.name} (${attempt}/${MAX_REGISTRY_LOOKUPS})`,
    );
    await setTimeout(retryDelay(attempt));
    return checkPublished(context, artifact, attempt + 1);
  }
};

/** A failed PUT may have committed; allow metadata a short time to appear. */
export const confirmPublication = async (
  context: PublishContext,
  artifact: ReleaseArtifact,
  check = 1,
): Promise<boolean> => {
  const published = await checkPublished(context, artifact);
  if (published || check >= MAX_PUBLICATION_CHECKS) return published;
  await setTimeout(retryDelay(check));
  return confirmPublication(context, artifact, check + 1);
};
