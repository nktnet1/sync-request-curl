import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    exclude: [...configDefaults.exclude, "tests/typedoc/**"],
    globalSetup: ["./tests/globalSetup.ts"],
    coverage: {
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/index-esm.ts",
        "src/types/*.ts",
        "src/internal/blob-reader-worker.ts",
      ],
    },
  },
});
