const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const betaVersion = /^(\d+\.\d+\.\d+)-beta\.(0|[1-9][0-9]*)$/;

/** Select a beta above the manifest, registry versions, and existing Git tags. */
export const nextBetaVersion = (
  current: string,
  published: string[],
  tags: string[],
): string => {
  const currentBeta = betaVersion.exec(current);
  const base = currentBeta?.[1] ?? current;
  if (!stableVersion.test(base) || !base.startsWith("5.")) {
    throw new Error(
      "Expected a v5 stable or numbered beta version in package.json",
    );
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
    const match = betaVersion.exec(version);
    if (match?.[1] === base) {
      const number = BigInt(match[2]);
      if (number > highest) highest = number;
    }
  }
  return `${base}-beta.${highest + 1n}`;
};
