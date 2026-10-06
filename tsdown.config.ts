import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: {
      index: "./src/index.ts",
    },
    format: "commonjs",
    platform: "node",
    outDir: "./dist",
    dts: true,
    clean: true,
    minify: false,
    sourcemap: true,
    exports: false,
    cjsDefault: true,
  },
  {
    entry: {
      "index-esm": "./src/index-esm.ts",
    },
    // Keep the ESM wrapper on the same implementation and declarations as CJS.
    deps: { neverBundle: ["#/index"] },
    outputOptions: { paths: { "#/index": "./index.cjs" } },
    format: "esm",
    platform: "node",
    outDir: "./dist",
    dts: true,
    clean: false,
    minify: false,
    sourcemap: true,
    exports: false,
  },
]);
