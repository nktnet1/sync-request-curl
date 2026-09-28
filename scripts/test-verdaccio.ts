import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, styleText } from "node:util";
import { getNativePackageName } from "#/native/platform-key-core";
import { getCurrentPlatformKey } from "#scripts/native-platform";
import { canRun, run } from "#scripts/process";
import {
  createMainPackageManifest,
  createNativePackageManifest,
  parseReleasePackageJson,
} from "#scripts/release-package";
import { parseReleaseVersion } from "#scripts/release-policy";

interface PackResult {
  filename: string;
}

const VERDACCIO_VERSION = "6.10.4";
const STARTUP_TIMEOUT_MS = 120_000;
const root = resolve(import.meta.dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageJson = parseReleasePackageJson(
  readFileSync(join(root, "package.json"), "utf8"),
);
const platform = getCurrentPlatformKey();
const nativePackageName = getNativePackageName(platform);
const nativeBinary = join(
  root,
  "native",
  "build",
  "sync_request_curl_native.node",
);

const { values } = parseArgs({
  options: {
    keep: { type: "boolean", default: false },
    "verdaccio-version": { type: "string", default: VERDACCIO_VERSION },
  },
});

const temporaryRoot = mkdtempSync(
  join(tmpdir(), "sync-request-curl-verdaccio-"),
);
const verdaccioRoot = join(temporaryRoot, "verdaccio");
const packagesRoot = join(temporaryRoot, "packages");
const mainPackageRoot = join(packagesRoot, "main");
const nativePackageRoot = join(packagesRoot, "native");
const tarballsRoot = join(temporaryRoot, "tarballs");
const consumerRoot = join(temporaryRoot, "consumer");
const configPath = join(verdaccioRoot, "config.yaml");
const verdaccioLog = join(verdaccioRoot, "verdaccio.log");
const npmrcPath = join(temporaryRoot, ".npmrc");

let verdaccioProcess: ChildProcess | undefined;
let verdaccioLogFd: number | undefined;
let smokeServerProcess: ChildProcess | undefined;
let smokeServerOutput = "";

const accent = (value: string): string => styleText("cyan", value);

const stage = (message: string): void => {
  console.log(
    `\n${styleText(["bold", "cyan"], "==>")} ${styleText("bold", message)}`,
  );
};

const success = (message: string): void => {
  console.log(`    ${styleText(["bold", "green"], "OK")} ${message}`);
};

const detail = (message: string): void => {
  console.log(`       ${styleText("gray", "·")} ${message}`);
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const reservePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a local Verdaccio port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });

const stagePackages = (): void => {
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

const createVerdaccioConfig = (): void => {
  mkdirSync(verdaccioRoot, { recursive: true });
  writeFileSync(
    configPath,
    [
      `storage: ${JSON.stringify(join(verdaccioRoot, "storage"))}`,
      "auth:",
      "  htpasswd:",
      `    file: ${JSON.stringify(join(verdaccioRoot, "htpasswd"))}`,
      "    max_users: 10",
      "uplinks:",
      "  npmjs:",
      '    url: "https://registry.npmjs.org/"',
      "packages:",
      '  "@nktnet/*":',
      '    access: "$all"',
      '    publish: "$authenticated"',
      '    unpublish: "$authenticated"',
      '  "sync-request-curl":',
      '    access: "$all"',
      '    publish: "$authenticated"',
      '    unpublish: "$authenticated"',
      '  "**":',
      '    access: "$all"',
      '    publish: "$authenticated"',
      '    unpublish: "$authenticated"',
      '    proxy: "npmjs"',
      "log:",
      '  type: "stdout"',
      '  format: "pretty"',
      '  level: "warn"',
      "  redact:",
      '    paths: ["req.header.authorization", "req.header.cookie"]',
      '    censor: "<redacted>"',
      "",
    ].join("\n"),
  );
};

const startVerdaccio = (registry: string): void => {
  const listen = new URL(registry);
  verdaccioLogFd = openSync(verdaccioLog, "a");
  verdaccioProcess = spawn(
    pnpmCommand,
    [
      "dlx",
      `verdaccio@${values["verdaccio-version"]}`,
      "--config",
      configPath,
      "--listen",
      `${listen.hostname}:${listen.port}`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        VERDACCIO_HANDLE_KILL_SIGNALS: "true",
      },
      stdio: ["ignore", verdaccioLogFd, verdaccioLogFd],
    },
  );
};

const waitForVerdaccio = async (registry: string): Promise<void> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (verdaccioProcess && verdaccioProcess.exitCode !== null) {
      const log = existsSync(verdaccioLog)
        ? readFileSync(verdaccioLog, "utf8").trim()
        : "";
      const logSuffix = log ? `:\n${log}` : "";
      throw new Error(`Verdaccio exited before becoming ready${logSuffix}`);
    }

    try {
      const response = await fetch(`${registry}/-/ping`);
      if (response.ok) {
        return;
      }
    } catch {
      // Verdaccio is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Verdaccio at ${registry}`);
};

const startSmokeServer = async (): Promise<string> => {
  const port = await reservePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const serverPath = join(temporaryRoot, "request-smoke-server.mjs");
  writeFileSync(
    serverPath,
    [
      'import { createServer } from "node:http";',
      'const port = Number.parseInt(process.argv[2] ?? "", 10);',
      'if (!Number.isInteger(port)) throw new TypeError("Missing smoke-server port");',
      "const server = createServer((request, response) => {",
      '  if (request.method === "GET" && request.url === "/health") {',
      "    response.writeHead(204);",
      "    response.end();",
      "    return;",
      "  }",
      '  if (request.method === "GET" && request.url === "/smoke") {',
      "    response.writeHead(200, {",
      '      "content-type": "application/json",',
      '      "x-smoke-test": "ok",',
      "    });",
      "    response.end(JSON.stringify({",
      "      ok: true,",
      "      method: request.method,",
      '      client: request.headers["x-smoke-client"] ?? null,',
      "    }));",
      "    return;",
      "  }",
      '  response.writeHead(404, { "content-type": "text/plain" });',
      '  response.end("not found");',
      "});",
      'server.listen(port, "127.0.0.1");',
      "const shutdown = () => server.close(() => process.exit(0));",
      'process.on("SIGINT", shutdown);',
      'process.on("SIGTERM", shutdown);',
      "",
    ].join("\n"),
  );

  smokeServerOutput = "";
  smokeServerProcess = spawn(process.execPath, [serverPath, String(port)], {
    cwd: temporaryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  smokeServerProcess.stdout?.on("data", (chunk: Buffer) => {
    smokeServerOutput += chunk.toString();
  });
  smokeServerProcess.stderr?.on("data", (chunk: Buffer) => {
    smokeServerOutput += chunk.toString();
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (smokeServerProcess.exitCode !== null) {
      throw new Error(
        `Request smoke server exited before becoming ready${
          smokeServerOutput.trim() ? `:\n${smokeServerOutput.trim()}` : ""
        }`,
      );
    }
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (response.status === 204) {
        return serverUrl;
      }
    } catch {
      // The request smoke server is still starting.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for request smoke server at ${serverUrl}`);
};

const createVerdaccioUser = async (registry: string): Promise<string> => {
  const username = `smoke-${process.pid}`;
  const password = randomBytes(24).toString("base64url");
  const response = await fetch(
    `${registry}/-/user/org.couchdb.user:${encodeURIComponent(username)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: username,
        password,
        email: `${username}@example.invalid`,
        type: "user",
        roles: [],
      }),
    },
  );

  const responseText = await response.text();
  const body = JSON.parse(responseText) as { token?: unknown; error?: unknown };
  if (!response.ok || typeof body.token !== "string") {
    throw new Error(`Unable to create Verdaccio test user: ${responseText}`);
  }
  return body.token;
};

const writeNpmrc = (registry: string, token: string): void => {
  const url = new URL(registry);
  const authKey = `//${url.host}/`;
  writeFileSync(
    npmrcPath,
    [
      `registry=${registry}/`,
      `@nktnet:registry=${registry}/`,
      `${authKey}:_authToken=${token}`,
      "",
    ].join("\n"),
  );
};

const packPackage = (directory: string, npmEnv: NodeJS.ProcessEnv): string => {
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

const verifyPublishedMetadata = (
  registry: string,
  npmEnv: NodeJS.ProcessEnv,
): void => {
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

const verifyPublishedDistTags = (
  registry: string,
  npmEnv: NodeJS.ProcessEnv,
  distTag: string,
): void => {
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

const verifyCleanInstall = async (
  registry: string,
  npmEnv: NodeJS.ProcessEnv,
): Promise<void> => {
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

const stopChildProcess = async (
  child: ChildProcess | undefined,
): Promise<void> => {
  if (child?.exitCode !== null) {
    return;
  }
  const exited = once(child, "exit").then(() => true);
  child.kill("SIGTERM");
  const timedOut = delay(5_000, false, { ref: false });
  if (!(await Promise.race([exited, timedOut]))) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
};

const stopSmokeServer = async (): Promise<void> => {
  await stopChildProcess(smokeServerProcess);
  smokeServerProcess = undefined;
};

const stopVerdaccio = async (): Promise<void> => {
  await stopChildProcess(verdaccioProcess);
  verdaccioProcess = undefined;
  if (verdaccioLogFd !== undefined) {
    closeSync(verdaccioLogFd);
    verdaccioLogFd = undefined;
  }
};

const requireCommand = (command: string): void => {
  if (!canRun(command)) {
    throw new Error(`${command} is required for the Verdaccio smoke test`);
  }
};

const main = async (): Promise<void> => {
  stage("Checking local prerequisites");
  requireCommand(npmCommand);
  requireCommand(pnpmCommand);
  success("npm and pnpm are available");

  const port = await reservePort();
  const registry = `http://127.0.0.1:${port}`;
  const mainPackageSpec = `${packageJson.name}@${packageJson.version}`;
  const nativePackageSpec = `${nativePackageName}@${packageJson.version}`;
  const { distTag } = parseReleaseVersion(packageJson.version);
  createVerdaccioConfig();

  stage(`Building ${accent(mainPackageSpec)} for ${accent(platform)}`);
  run(pnpmCommand, ["build"], { cwd: root });
  run(pnpmCommand, ["build:native"], { cwd: root });
  success("JavaScript and current-platform native builds completed");

  stage("Staging the main package and current-platform optional dependency");
  stagePackages();
  success(`${accent(nativePackageSpec)} staged`);

  stage(
    `Starting disposable Verdaccio ${accent(values["verdaccio-version"] ?? VERDACCIO_VERSION)}`,
  );
  detail(accent(registry));
  startVerdaccio(registry);
  await waitForVerdaccio(registry);
  success("Verdaccio is ready");

  stage("Creating temporary Verdaccio publish credentials");
  const token = await createVerdaccioUser(registry);
  writeNpmrc(registry, token);
  const npmEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: npmrcPath,
  };
  success("Temporary publisher authenticated");

  stage("Packing release tarballs");
  const nativeTarball = packPackage(nativePackageRoot, npmEnv);
  const mainTarball = packPackage(mainPackageRoot, npmEnv);
  detail(accent(basename(nativeTarball)));
  detail(accent(basename(mainTarball)));
  success("Release tarballs created");

  stage(`Publishing ${accent(nativePackageName)} before the main package`);
  run(
    npmCommand,
    [
      "publish",
      nativeTarball,
      "--registry",
      registry,
      "--access",
      "public",
      "--ignore-scripts",
      "--tag",
      distTag,
    ],
    { cwd: root, capture: true, env: npmEnv },
  );
  success(`${accent(nativePackageSpec)} published`);

  stage(`Publishing ${accent(mainPackageSpec)}`);
  run(
    npmCommand,
    [
      "publish",
      mainTarball,
      "--registry",
      registry,
      "--ignore-scripts",
      "--tag",
      distTag,
    ],
    { cwd: root, capture: true, env: npmEnv },
  );
  success(`${accent(mainPackageSpec)} published`);

  stage("Verifying published optional-dependency metadata");
  verifyPublishedMetadata(registry, npmEnv);
  verifyPublishedDistTags(registry, npmEnv, distTag);
  success(
    `Main package points to ${accent(nativePackageSpec)} and both packages use the ${accent(distTag)} dist-tag`,
  );

  await verifyCleanInstall(registry, npmEnv);
};

let passed = false;
try {
  await main();
  passed = true;
} catch (error) {
  if (existsSync(verdaccioLog)) {
    const log = readFileSync(verdaccioLog, "utf8").trim();
    if (log) {
      console.error(`\nVerdaccio log:\n${log}`);
    }
  }
  throw error;
} finally {
  await Promise.all([stopSmokeServer(), stopVerdaccio()]);
  if (values.keep) {
    console.log(
      `${styleText(["bold", "yellow"], "KEPT")} Verdaccio smoke-test files at ${temporaryRoot}`,
    );
  } else {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (passed) {
  console.log(
    `\n${styleText(["bold", "green"], "PASS")} ${styleText("bold", "Verdaccio publish + request smoke test")} (${accent(platform)})`,
  );
}
