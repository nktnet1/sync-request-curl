import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { styleText } from "node:util";
import type { ReleaseArtifact } from "#scripts/release/policy";
import {
  checkPublished,
  confirmPublication,
  retryableNpmError,
  retryDelay,
} from "#scripts/release/registry-checks";

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

const MAX_PUBLISH_ATTEMPTS = 3;

export interface PublishContext {
  npmCli: string;
  registry: string;
  version: string;
}

const npmArgs = (npmCli: string, args: string[]): string[] => [npmCli, ...args];

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
