import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { styleText } from "node:util";
import type { ReleaseArtifact } from "#scripts/release-policy";

export const resolveNpmCli = (): string => {
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

const MAX_REGISTRY_LOOKUPS = 3;
const MAX_PUBLICATION_CHECKS = 3;
const MAX_PUBLISH_ATTEMPTS = 3;
const retryableNpmError =
  /\b(?:E408|E429|E500|E502|E503|E504|EAI_AGAIN|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPIPE)\b/;

export interface PublishContext {
  npmCli: string;
  registry: string;
  version: string;
}

const npmArgs = (npmCli: string, args: string[]): string[] => [npmCli, ...args];

const retryDelay = (attempt: number): number => attempt * 2_000;

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
const checkPublished = async (
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
const confirmPublication = async (
  context: PublishContext,
  artifact: ReleaseArtifact,
  check = 1,
): Promise<boolean> => {
  const published = await checkPublished(context, artifact);
  if (published || check >= MAX_PUBLICATION_CHECKS) return published;
  await setTimeout(retryDelay(check));
  return confirmPublication(context, artifact, check + 1);
};

type PublishAttempt =
  | { success: true }
  | { success: false; transient: boolean; error: Error };

const attemptPublish = (
  { npmCli, registry }: PublishContext,
  { file, manifest }: ReleaseArtifact,
  distTag: string,
): PublishAttempt => {
  // Preserve npm's interactive prompts for local TTY publishing. In CI,
  // capture the errors so only transient registry failures are retried.
  const captureOutput = !process.stdin.isTTY;
  const result = spawnSync(
    process.execPath,
    npmArgs(npmCli, [
      "publish",
      file,
      "--registry",
      registry,
      "--access",
      "public",
      "--ignore-scripts",
      "--tag",
      distTag,
      "--fetch-retries=0",
    ]),
    {
      encoding: "utf8",
      stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (captureOutput) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  if (result.status === 0) return { success: true };

  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n");
  const detailSuffix = detail ? `: ${detail.trim()}` : "";
  return {
    success: false,
    transient: retryableNpmError.test(detail),
    error: new Error(
      `npm publish ${manifest.name} failed (exit ${result.status ?? "signal"})${detailSuffix}`,
    ),
  };
};

export const publishWithRecovery = async (
  context: PublishContext,
  artifact: ReleaseArtifact,
  distTag: string,
  attempt = 1,
): Promise<void> => {
  const result = attemptPublish(context, artifact, distTag);
  if (result.success) return;

  const label = `${artifact.manifest.name}@${context.version}`;
  let published: boolean;
  try {
    published = await confirmPublication(context, artifact);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Published tarball differs from local artifact:")
    ) {
      throw error;
    }
    throw new Error(
      `Publish failed for ${label} and registry state could not be verified; do not republish without checking the original tarball`,
      { cause: error },
    );
  }
  if (published) {
    console.log(
      `${styleText("green", "RECOVERED")} ${label} matches the published tarball after npm reported an error`,
    );
    return;
  }
  if (!result.transient || attempt >= MAX_PUBLISH_ATTEMPTS) {
    throw result.error;
  }

  console.warn(
    `${styleText("yellow", "RETRY")} npm publish ${label} (${attempt}/${MAX_PUBLISH_ATTEMPTS}); confirmed not yet published`,
  );
  await setTimeout(retryDelay(attempt));
  await publishWithRecovery(context, artifact, distTag, attempt + 1);
};

export const preflightRelease = async (
  context: PublishContext,
  plan: ReleaseArtifact[],
): Promise<ReleaseArtifact[]> => {
  const pending: ReleaseArtifact[] = [];
  await plan.reduce<Promise<void>>(
    (previous, artifact) =>
      previous.then(async () => {
        const alreadyPublished = await checkPublished(context, artifact);
        if (alreadyPublished) {
          console.log(
            `Identical ${artifact.manifest.name}@${context.version} already published; skipping`,
          );
        } else {
          pending.push(artifact);
        }
      }),
    Promise.resolve(),
  );
  return pending;
};
