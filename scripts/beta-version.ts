import { parseReleaseVersion } from "#scripts/release-policy";

/** Select a beta above the manifest, registry versions, and existing Git tags. */
export const nextBetaVersion = (
  current: string,
  published: string[],
  tags: string[],
): string => {
  const { base } = parseReleaseVersion(current);
  if (!base.startsWith("5.")) {
    throw new Error("Expected a v5 version in package.json");
  }
  if (published.includes(base)) {
    throw new Error(
      `${base} is already released; set a new v5 base version first`,
    );
  }
  let highest = 0n;
  for (const version of [
    current,
    ...published,
    ...tags.map((tag) => tag.replace(/^v/, "")),
  ]) {
    // Other releases may use channels this publisher does not support.
    let parsed: ReturnType<typeof parseReleaseVersion>;
    try {
      parsed = parseReleaseVersion(version);
    } catch {
      continue;
    }
    if (parsed.base === base && parsed.beta !== undefined) {
      const number = BigInt(parsed.beta);
      if (number > highest) highest = number;
    }
  }
  return `${base}-beta.${highest + 1n}`;
};
