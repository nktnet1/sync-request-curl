import { parseReleaseVersion } from "#scripts/release-policy";

const normalizeRequestedBase = (requestedBase: string): string => {
  const normalized = requestedBase.startsWith("v")
    ? requestedBase.slice(1)
    : requestedBase;
  const parsed = parseReleaseVersion(normalized);
  if (!parsed.base.startsWith("5.")) {
    throw new Error("Expected --base to be a v5 version");
  }
  if (parsed.beta !== undefined) {
    throw new Error(
      "Expected --base to be a stable v5 version without a prerelease suffix",
    );
  }
  return parsed.base;
};

const betaNumberForBase = (version: string, base: string): bigint => {
  // Ignore unrelated release channels, including versions we cannot parse.
  try {
    const parsed = parseReleaseVersion(version);
    return parsed.base === base && parsed.beta !== undefined
      ? BigInt(parsed.beta)
      : 0n;
  } catch {
    return 0n;
  }
};

/** Select a beta above the manifest, registry versions, and existing Git tags. */
export const nextBetaVersion = (
  current: string,
  published: string[],
  tags: string[],
  requestedBase?: string,
): string => {
  const currentRelease = parseReleaseVersion(current);
  if (!currentRelease.base.startsWith("5.")) {
    throw new Error("Expected a v5 version in package.json");
  }
  const base =
    requestedBase === undefined
      ? currentRelease.base
      : normalizeRequestedBase(requestedBase);
  if (published.includes(base)) {
    const guidance =
      requestedBase === undefined
        ? "; choose the next v5 base explicitly with --base <version>"
        : "";
    throw new Error(`${base} is already released${guidance}`);
  }
  const highest = [
    current,
    ...published,
    ...tags.map((tag) => tag.replace(/^v/, "")),
  ].reduce((highest, version) => {
    const number = betaNumberForBase(version, base);
    if (number > highest) return number;
    return highest;
  }, 0n);
  return `${base}-beta.${highest + 1n}`;
};
