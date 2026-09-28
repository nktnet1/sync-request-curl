import { defineConfig } from "tsdown";

const shared = {
  format: "esm" as const,
  platform: "node" as const,
  target: "node16.17",
  fixedExtension: true,
  dts: false,
  clean: false,
  minify: false,
  sourcemap: false,
  exports: false,
};

export default defineConfig([
  {
    ...shared,
    entry: { build: "./native/build.ts" },
    outDir: "./native",
  },
  {
    ...shared,
    entry: { "source-build.check": "./tests/build/source-build.check.ts" },
    outDir: "./tests/build",
  },
]);
