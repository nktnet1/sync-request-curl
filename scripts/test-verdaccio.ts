import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, styleText } from "node:util";
import { getNativePackageName } from "#/native/platform-key-core";
import { reserveLoopbackPort } from "#scripts/loopback-port";
import { getCurrentPlatformKey } from "#scripts/native-platform";
import { pollUntilReady } from "#scripts/poll-until-ready";
import { canRun, run } from "#scripts/process";
import { parseReleasePackageJson } from "#scripts/release/package";
import { parseReleaseVersion } from "#scripts/release/policy";
import {
  packPackage,
  type SmokeContext,
  stagePackages,
  verifyCleanInstall,
  verifyPublishedDistTags,
  verifyPublishedMetadata,
} from "#scripts/verdaccio/packages";
import { launchSmokeServer } from "#scripts/verdaccio/server";

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

const checkVerdaccioStillRunning = (): void => {
  if (!verdaccioProcess || verdaccioProcess.exitCode === null) return;
  const log = existsSync(verdaccioLog)
    ? readFileSync(verdaccioLog, "utf8").trim()
    : "";
  throw new Error(
    `Verdaccio exited before becoming ready${log ? `:\n${log}` : ""}`,
  );
};

const pingVerdaccio = async (registry: string): Promise<boolean> => {
  try {
    const response = await fetch(`${registry}/-/ping`);
    return response.ok;
  } catch {
    // Verdaccio is still starting.
    return false;
  }
};

const waitForVerdaccio = async (registry: string): Promise<void> => {
  const ready = await pollUntilReady(
    () => {
      checkVerdaccioStillRunning();
      return pingVerdaccio(registry);
    },
    250,
    Date.now() + STARTUP_TIMEOUT_MS,
  );
  if (!ready) throw new Error(`Timed out waiting for Verdaccio at ${registry}`);
};

const startSmokeServer = (): Promise<string> =>
  launchSmokeServer(temporaryRoot, (process) => {
    smokeServerProcess = process;
  });

const smokeContext: SmokeContext = {
  root,
  mainPackageRoot,
  nativePackageRoot,
  tarballsRoot,
  consumerRoot,
  nativeBinary,
  nativePackageName,
  platform,
  packageJson,
  npmCommand,
  stage,
  success,
  detail,
  accent,
  startSmokeServer,
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

  const port = await reserveLoopbackPort();
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
  stagePackages(smokeContext);
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
  const nativeTarball = packPackage(smokeContext, nativePackageRoot, npmEnv);
  const mainTarball = packPackage(smokeContext, mainPackageRoot, npmEnv);
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
  verifyPublishedMetadata(smokeContext, registry, npmEnv);
  verifyPublishedDistTags(smokeContext, registry, npmEnv, distTag);
  success(
    `Main package points to ${accent(nativePackageSpec)} and both packages use the ${accent(distTag)} dist-tag`,
  );

  await verifyCleanInstall(smokeContext, registry, npmEnv);
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
