import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readTarEntry, TAR_BLOCK_BYTES } from "#scripts/release/tar-entry";

const MAX_PACKAGE_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

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
