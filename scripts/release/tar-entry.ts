export const TAR_BLOCK_BYTES = 512;

const readTarString = (
  block: Buffer,
  offset: number,
  length: number,
): string => {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
};

const readTarSize = (block: Buffer): number => {
  const value = readTarString(block, 124, 12).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar entry size");
  const size = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size)) throw new Error("Invalid tar entry size");
  return size;
};

const assertTarChecksum = (header: Buffer): void => {
  const expectedChecksum = readTarString(header, 148, 8).trim();
  const checksum = header.reduce(
    (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  if (
    !/^[0-7]+$/.test(expectedChecksum) ||
    Number.parseInt(expectedChecksum, 8) !== checksum
  ) {
    throw new Error("Invalid tar header checksum");
  }
};

const assertCanonicalTarPath = (entry: string, isDirectory: boolean): void => {
  const path = entry.replace(/\/$/, "");
  const segments = path.split("/");
  const validRoot = segments[0] === "package";
  const validSegments = segments.every(
    (segment) => !["", ".", ".."].includes(segment),
  );
  const validFile =
    isDirectory || (segments.length >= 2 && !entry.endsWith("/"));
  const canonicalManifest =
    path.toLowerCase() !== "package/package.json" ||
    path === "package/package.json";
  const canonical = [
    validRoot,
    validSegments,
    validFile,
    canonicalManifest,
    !entry.includes("\\"),
  ].every(Boolean);
  if (!canonical) {
    throw new Error(`Non-canonical tar entry path: ${entry}`);
  }
};

export const readTarEntry = (header: Buffer) => {
  assertTarChecksum(header);
  if (readTarString(header, 257, 6) !== "ustar") {
    throw new Error("Unsupported tar archive format");
  }
  // npm extracts archives before reading their manifest. Do not accept links
  // or PAX/GNU extensions whose path semantics differ from this bounded reader.
  const type = header[156];
  if (![0, 48, 53].includes(type)) {
    throw new Error("Unsupported tar entry type");
  }
  const name = readTarString(header, 0, 100);
  const prefix = readTarString(header, 345, 155);
  const entry = prefix ? `${prefix}/${name}` : name;
  const isDirectory = type === 53;
  assertCanonicalTarPath(entry, isDirectory);
  const size = readTarSize(header);
  if (isDirectory && size !== 0) throw new Error("Invalid tar directory size");
  return { entry: entry.replace(/\/$/, ""), size, isDirectory };
};
