import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    errors: "./src/errors.ts",
    types: "./src/types.ts",
  },
  format: ["commonjs", "esm"],
  platform: "node",
  outDir: "./dist",
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
  exports: true,
  cjsDefault: true,
  copy: {
    from: "./src/internal/blob-reader-worker.cjs",
    to: "./dist/internal",
  },
});
