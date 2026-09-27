import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "blob-reader-worker": "./src/internal/blob-reader-worker.ts",
  },
  format: "commonjs",
  platform: "node",
  outDir: "./dist/internal",
  dts: false,
  clean: false,
  minify: true,
  sourcemap: true,
  exports: false,
});
