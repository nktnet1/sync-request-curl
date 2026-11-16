import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** Register automatic cleanup and return a factory for canonical temp directories. */
export const useTemporaryDirectories = (): ((prefix: string) => string) => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  return (prefix: string): string => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    directories.push(directory);
    return directory;
  };
};
