import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/globalSetup.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/index-esm.ts",
        "src/types.ts",
        "src/internal/blob-reader-worker.ts",
      ],
    },
  },
});
