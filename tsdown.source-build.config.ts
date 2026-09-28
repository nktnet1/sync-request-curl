import { defineConfig, type UserConfig } from "tsdown";

const shared: UserConfig = {
  format: "esm",
  platform: "node",
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
    banner: "#!/usr/bin/env node",
  },
  {
    ...shared,
    entry: { "source-build.check": "./tests/build/source-build.check.ts" },
    outDir: "./tests/build",
  },
]);
