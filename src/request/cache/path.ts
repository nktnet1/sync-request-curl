import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const fileCacheDirectory = join(
  tmpdir(),
  `sync-request-curl-${typeof process.getuid === "function" ? process.getuid() : "user"}`,
  "cache",
);

export const getCachePath = (url: string): string =>
  join(
    fileCacheDirectory,
    `${createHash("sha512").update(url).digest("hex")}.json`,
  );
