import { defineConfig } from "tsdown";

export default defineConfig([
  {
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
    minify: false,
    sourcemap: true,
    exports: false,
    cjsDefault: true,
  },
  {
    entry: {
      "index-esm": "./src/index-esm.ts",
    },
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
