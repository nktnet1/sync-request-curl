import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { NativePlatformKey } from "#/native/platform-key-core";
import { run } from "#scripts/process";
import {
  createMainPackageManifest,
  createNativePackageManifest,
  type ReleasePackageJson,
} from "#scripts/release/package";

interface PackResult {
  filename: string;
}

export interface SmokeContext {
  root: string;
  mainPackageRoot: string;
  nativePackageRoot: string;
  tarballsRoot: string;
  consumerRoot: string;
  nativeBinary: string;
  nativePackageName: string;
  platform: NativePlatformKey;
  packageJson: ReleasePackageJson;
  npmCommand: string;
  stage: (message: string) => void;
  success: (message: string) => void;
  detail: (message: string) => void;
  accent: (value: string) => string;
  startSmokeServer: () => Promise<string>;
}

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const stagePackages = (ctx: SmokeContext): void => {
  const {
    root,
    mainPackageRoot,
    nativePackageRoot,
    tarballsRoot,
    nativeBinary,
    nativePackageName,
    platform,
    packageJson,
  } = ctx;
  if (!existsSync(join(root, "dist"))) {
    throw new Error("Missing dist/. The JavaScript build did not complete.");
  }
  if (!existsSync(nativeBinary) || statSync(nativeBinary).size === 0) {
    throw new Error("Missing native/build/sync_request_curl_native.node");
  }

  mkdirSync(mainPackageRoot, { recursive: true });
  mkdirSync(nativePackageRoot, { recursive: true });
  mkdirSync(tarballsRoot, { recursive: true });

  cpSync(join(root, "dist"), join(mainPackageRoot, "dist"), {
    recursive: true,
  });
  cpSync(join(root, "README.md"), join(mainPackageRoot, "README.md"));
  cpSync(join(root, "LICENSE"), join(mainPackageRoot, "LICENSE"));

  writeJson(
    join(mainPackageRoot, "package.json"),
    createMainPackageManifest(packageJson, {
      [nativePackageName]: packageJson.version,
    }),
  );

  cpSync(
    nativeBinary,
    join(nativePackageRoot, "sync_request_curl_native.node"),
  );
  cpSync(join(root, "LICENSE"), join(nativePackageRoot, "LICENSE"));
  writeFileSync(
    join(nativePackageRoot, "README.md"),
    `# ${nativePackageName}\n\n` +
      `Platform-specific native binary for \`${packageJson.name}\` (${platform}). ` +
      `Install \`${packageJson.name}\` instead of depending on this package directly.\n`,
  );
  writeJson(
    join(nativePackageRoot, "package.json"),
    createNativePackageManifest(packageJson, platform),
  );
};

export const packPackage = (
  ctx: SmokeContext,
  directory: string,
  npmEnv: NodeJS.ProcessEnv,
): string => {
  const { npmCommand, tarballsRoot, root } = ctx;
  const output = run(
    npmCommand,
    [
      "pack",
      directory,
      "--pack-destination",
      tarballsRoot,
      "--ignore-scripts",
      "--json",
    ],
    { cwd: root, capture: true, env: npmEnv },
  );
  const results = JSON.parse(output) as PackResult[];
  if (results.length !== 1 || typeof results[0]?.filename !== "string") {
    throw new Error(`Unexpected npm pack output: ${output}`);
  }
  return join(tarballsRoot, results[0].filename);
};

export const verifyPublishedMetadata = (
  ctx: SmokeContext,
  registry: string,
  npmEnv: NodeJS.ProcessEnv,
): void => {
  const { npmCommand, nativePackageName, packageJson } = ctx;
  const optionalDependencies = JSON.parse(
    run(
      npmCommand,
      [
        "view",
        `${packageJson.name}@${packageJson.version}`,
        "optionalDependencies",
        "--json",
        "--registry",
        registry,
      ],
      { capture: true, env: npmEnv },
    ),
  ) as Record<string, string>;

  if (optionalDependencies[nativePackageName] !== packageJson.version) {
    throw new Error(
      `${packageJson.name} is missing ${nativePackageName}@${packageJson.version} as an optional dependency`,
    );
  }
};

export const verifyPublishedDistTags = (
  ctx: SmokeContext,
  registry: string,
  npmEnv: NodeJS.ProcessEnv,
  distTag: string,
): void => {
  const { npmCommand, nativePackageName, packageJson } = ctx;
  for (const packageName of [nativePackageName, packageJson.name]) {
    const distTags = JSON.parse(
      run(
        npmCommand,
        ["view", packageName, "dist-tags", "--json", "--registry", registry],
        { capture: true, env: npmEnv },
      ),
    ) as Record<string, string>;
    if (distTags[distTag] !== packageJson.version) {
      throw new Error(
        `${packageName} ${distTag} dist-tag points to ${distTags[distTag] ?? "nothing"}, expected ${packageJson.version}`,
      );
    }
  }
};

export const verifyCleanInstall = async (
  ctx: SmokeContext,
  registry: string,
  npmEnv: NodeJS.ProcessEnv,
): Promise<void> => {
  const {
    consumerRoot,
    nativePackageName,
    packageJson,
    npmCommand,
    stage,
    success,
    detail,
    accent,
    startSmokeServer,
  } = ctx;
  mkdirSync(consumerRoot, { recursive: true });
  writeJson(join(consumerRoot, "package.json"), {
    private: true,
    name: "sync-request-curl-verdaccio-smoke",
    version: "0.0.0",
  });

  stage("Installing the published package into a clean consumer project");
  run(
    npmCommand,
    [
      "install",
      `${packageJson.name}@${packageJson.version}`,
      "--registry",
      registry,
      "--ignore-scripts",
      "--package-lock=false",
    ],
    { cwd: consumerRoot, env: npmEnv },
  );

  const nativeDirectoryName = nativePackageName.slice("@nktnet/".length);
  const nativeDirectory = join(consumerRoot, "node_modules", "@nktnet");
  const installedNativePackages = existsSync(nativeDirectory)
    ? readdirSync(nativeDirectory).sort()
    : [];
  if (
    installedNativePackages.length !== 1 ||
    installedNativePackages[0] !== nativeDirectoryName
  ) {
    throw new Error(
      `Expected only ${nativePackageName}, installed: ${installedNativePackages.join(", ") || "none"}`,
    );
  }

  const installedBinary = join(
    nativeDirectory,
    nativeDirectoryName,
    "sync_request_curl_native.node",
  );
  if (!existsSync(installedBinary) || statSync(installedBinary).size === 0) {
    throw new Error(`Missing installed native binary: ${installedBinary}`);
  }
  success(`Installed ${accent(nativePackageName)} with its native binary`);

  stage("Starting a local HTTP server for real request smoke tests");
  const serverUrl = await startSmokeServer();
  detail(accent(serverUrl));
  success("Local HTTP server is ready");

  const smokeUrl = `${serverUrl}/smoke`;

  stage("Sending a CommonJS request through the freshly installed package");
  const commonJsSmoke = [
    `const request = require(${JSON.stringify(packageJson.name)});`,
    'if (typeof request !== "function") throw new TypeError("Expected CommonJS export to be a function");',
    `const response = request("GET", ${JSON.stringify(smokeUrl)}, { headers: { "x-smoke-client": "commonjs" } });`,
    'if (response.statusCode !== 200) throw new Error("Expected status 200, received " + response.statusCode);',
    'if (response.headers["x-smoke-test"] !== "ok") throw new Error("Missing x-smoke-test response header");',
    'const body = JSON.parse(response.getBody("utf8"));',
    'if (body.ok !== true || body.method !== "GET" || body.client !== "commonjs") throw new Error("Unexpected response body: " + JSON.stringify(body));',
  ].join("\n");
  run("node", ["-e", commonJsSmoke], { cwd: consumerRoot, env: npmEnv });
  success("CommonJS request returned the expected status, header, and body");

  stage("Sending an ESM request through the freshly installed package");
  const esmSmoke = [
    `import request from ${JSON.stringify(packageJson.name)};`,
    'if (typeof request !== "function") throw new TypeError("Expected ESM export to be a function");',
    `const response = request("GET", ${JSON.stringify(smokeUrl)}, { headers: { "x-smoke-client": "esm" } });`,
    'if (response.statusCode !== 200) throw new Error("Expected status 200, received " + response.statusCode);',
    'if (response.headers["x-smoke-test"] !== "ok") throw new Error("Missing x-smoke-test response header");',
    'const body = JSON.parse(response.getBody("utf8"));',
    'if (body.ok !== true || body.method !== "GET" || body.client !== "esm") throw new Error("Unexpected response body: " + JSON.stringify(body));',
  ].join("\n");
  run("node", ["--input-type=module", "-e", esmSmoke], {
    cwd: consumerRoot,
    env: npmEnv,
  });
  success("ESM request returned the expected status, header, and body");
};
