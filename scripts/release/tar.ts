import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const TAR_BLOCK_BYTES = 512;
const MAX_PACKAGE_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

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
  if (
    !validRoot ||
    !validSegments ||
    !validFile ||
    !canonicalManifest ||
    entry.includes("\\")
  ) {
    throw new Error(`Non-canonical tar entry path: ${entry}`);
  }
};

const readTarEntry = (header: Buffer) => {
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

const validateTarFooter = (
  archive: Buffer,
  offset: number,
  file: string,
): void => {
  if (
    archive.length - offset < 2 * TAR_BLOCK_BYTES ||
    archive.length % TAR_BLOCK_BYTES !== 0 ||
    !archive.subarray(offset).every((byte) => byte === 0)
  ) {
    throw new Error(`Invalid tar archive footer: ${file}`);
  }
};

const parsePackageManifest = (
  data: Buffer,
  file: string,
): Record<string, unknown> => {
  if (data.length > MAX_PACKAGE_MANIFEST_BYTES) {
    throw new Error(`Package manifest is too large: ${file}`);
  }
  const parsed: unknown = JSON.parse(data.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid package manifest: ${file}`);
  }
  return parsed as Record<string, unknown>;
};

interface TarEntryContents {
  nextOffset: number;
  manifest?: Record<string, unknown>;
}

const readArchiveEntryContents = (
  archive: Buffer,
  offset: number,
  file: string,
  entries: Set<string>,
): TarEntryContents => {
  const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES);
  const { entry, size, isDirectory } = readTarEntry(header);
  if (entries.has(entry)) throw new Error(`Duplicate tar entry: ${entry}`);
  entries.add(entry);

  const dataStart = offset + TAR_BLOCK_BYTES;
  const dataEnd = dataStart + size;
  const nextOffset =
    dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  if (nextOffset > archive.length) {
    throw new Error(`Truncated tarball: ${file}`);
  }
  const manifest =
    entry === "package/package.json" && !isDirectory
      ? parsePackageManifest(archive.subarray(dataStart, dataEnd), file)
      : undefined;
  return { nextOffset, manifest };
};

const findManifestInArchive = (
  archive: Buffer,
  file: string,
): Record<string, unknown> => {
  const entries = new Set<string>();
  let manifest: Record<string, unknown> | undefined;
  let hasFooter = false;
  for (let offset = 0; offset + TAR_BLOCK_BYTES <= archive.length; ) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) {
      validateTarFooter(archive, offset, file);
      hasFooter = true;
      break;
    }

    const entry = readArchiveEntryContents(archive, offset, file, entries);
    if (entry.manifest) manifest = entry.manifest;
    offset = entry.nextOffset;
  }

  if (!hasFooter) throw new Error(`Missing tar archive footer: ${file}`);
  if (!manifest) throw new Error(`Package manifest not found: ${file}`);
  return manifest;
};

export const readPackageManifest = (file: string): Record<string, unknown> => {
  const archive = gunzipSync(readFileSync(file), {
    maxOutputLength: MAX_PACKAGE_ARCHIVE_BYTES,
  });
  return findManifestInArchive(archive, file);
};
