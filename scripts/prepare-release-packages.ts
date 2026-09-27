import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  getNativePackageName,
  type NativePlatformKey,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import { getPrebuildFilename } from "#scripts/native-platform";
import {
  createMainPackageManifest,
  createNativePackageManifest,
  parseReleasePackageJson,
} from "#scripts/release-package";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = join(root, ".release");
const mainOutput = join(releaseRoot, "main");
const nativeOutput = join(releaseRoot, "native");
const prebuilds = join(root, "prebuilds");
const packageJson = parseReleasePackageJson(
  readFileSync(join(root, "package.json"), "utf8"),
);

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const copyCommonFiles = (output: string): void => {
  cpSync(join(root, "LICENSE"), join(output, "LICENSE"));
};

const optionalDependencies = Object.fromEntries(
  supportedPlatformKeys.map((platform) => [
    getNativePackageName(platform),
    packageJson.version,
  ]),
);

const prepareMainPackage = (): void => {
  mkdirSync(mainOutput, { recursive: true });
  cpSync(join(root, "dist"), join(mainOutput, "dist"), { recursive: true });
  cpSync(join(root, "README.md"), join(mainOutput, "README.md"));
  const nativeSource = join(mainOutput, "native");
  mkdirSync(nativeSource, { recursive: true });
  for (const file of [
    "Cargo.toml",
    "Cargo.lock",
    "build.rs",
    "build.mjs",
    "README.md",
    "src",
  ]) {
    cpSync(join(root, "native", file), join(nativeSource, file), {
      recursive: true,
    });
  }
  cpSync(
    join(root, "rust-toolchain.toml"),
    join(mainOutput, "rust-toolchain.toml"),
  );
  copyCommonFiles(mainOutput);
  writeJson(
    join(mainOutput, "package.json"),
    createMainPackageManifest(packageJson, optionalDependencies),
  );
};

const prepareNativePackage = (platform: NativePlatformKey): void => {
  const input = join(prebuilds, getPrebuildFilename(platform));
  if (!existsSync(input) || statSync(input).size === 0) {
    throw new Error(`Missing native prebuild: ${input}`);
  }

  const output = join(nativeOutput, platform);
  mkdirSync(output, { recursive: true });
  cpSync(input, join(output, "sync_request_curl_native.node"));
  copyCommonFiles(output);
  writeJson(
    join(output, "package.json"),
    createNativePackageManifest(packageJson, platform),
  );
  writeFileSync(
    join(output, "README.md"),
    `# ${getNativePackageName(platform)}\n\n` +
      `Platform-specific native binary for \`${packageJson.name}\`. ` +
      `Install \`${packageJson.name}\` instead of depending on this package directly.\n`,
  );
};

if (!existsSync(join(root, "dist"))) {
  throw new Error("Missing dist/. Run the JavaScript build before packaging.");
}

rmSync(releaseRoot, { recursive: true, force: true });
prepareMainPackage();
for (const platform of supportedPlatformKeys) {
  prepareNativePackage(platform);
}

console.log(
  `Prepared ${packageJson.name}@${packageJson.version} and ${supportedPlatformKeys.length} native packages in .release/.`,
);
