import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;

export const parseReleaseVersion = (version: string) => {
  const match = versionPattern.exec(version);
  if (match?.[0] !== version) {
    throw new Error(`Invalid or unsupported release version: ${version}`);
  }
  return {
    version,
    base: `${match[1]}.${match[2]}.${match[3]}`,
    beta: match[4],
    distTag: match[4] === undefined ? "latest" : "beta",
  };
};

export const versionFromReleaseTag = (tag: string): string => {
  if (!tag.startsWith("v")) throw new Error(`Invalid release tag: ${tag}`);
  return parseReleaseVersion(tag.slice(1)).version;
};

export const releaseLabel = (version: string): string =>
  `v${parseReleaseVersion(version).version}`;

export interface ReleaseArtifact {
  file: string;
  manifest: Record<string, unknown>;
}

/** Validate the complete release before publishing any package. */
export const planRelease = (
  artifacts: ReleaseArtifact[],
  version: string,
): ReleaseArtifact[] => {
  parseReleaseVersion(version);
  const nativeNames = supportedPlatformKeys.map(getNativePackageName);
  const expected = [...nativeNames, "sync-request-curl"];
  if (artifacts.length !== expected.length) {
    throw new Error(
      `Expected ${expected.length} release packages, found ${artifacts.length}`,
    );
  }
  const byName = new Map<string, ReleaseArtifact>();
  for (const artifact of artifacts) {
    const { name, version: actualVersion } = artifact.manifest;
    if (
      typeof name !== "string" ||
      !expected.includes(name) ||
      byName.has(name)
    ) {
      throw new Error(`Unexpected or duplicate package: ${String(name)}`);
    }
    if (actualVersion !== version)
      throw new Error(`Version mismatch for ${name}`);
    byName.set(name, artifact);
  }
  const main = byName.get("sync-request-curl");
  const optional = main?.manifest.optionalDependencies;
  if (!optional || typeof optional !== "object" || Array.isArray(optional)) {
    throw new Error("Main package is missing optional native dependencies");
  }
  const entries = Object.entries(optional);
  if (
    entries.length !== nativeNames.length ||
    entries.some(
      ([name, dependencyVersion]) =>
        !nativeNames.includes(name) || dependencyVersion !== version,
    )
  ) {
    throw new Error(
      "Main package must pin the complete native matrix to the release version",
    );
  }
  return expected.map((name) => {
    const artifact = byName.get(name);
    if (!artifact) throw new Error(`Missing package: ${name}`);
    return artifact;
  });
};
