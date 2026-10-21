import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getNativePackageName } from "#/native/platform-key-core";
import {
  bootstrapNativePackages,
  parseTrustedPublishers,
} from "#scripts/bootstrap-native-packages";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("#scripts/process", () => ({ run: mocks.run }));

const arm64 = getNativePackageName("freebsd-arm64");
const x64 = getNativePackageName("freebsd-x64");
const registry = "https://registry.npmjs.org/";
const expectedTrust = {
  type: "github",
  repository: "nktnet1/sync-request-curl",
  file: "publish.yaml",
  environment: "Production",
  permissions: ["createPackage"],
};

interface MockCommand {
  command: string;
  args: string[];
  cwd?: string;
}

const createCommandMock = ({
  missing = [],
  trusted = {},
  version = "11.19.0",
}: {
  missing?: string[];
  trusted?: Record<string, unknown>;
  version?: string;
} = {}) => {
  const unpublished = new Set(missing);
  const commands: MockCommand[] = [];
  const manifests: Record<string, unknown>[] = [];
  mocks.run.mockImplementation(
    (command: string, args: string[], options?: { cwd?: string }) => {
      commands.push({ command, args, cwd: options?.cwd });
      if (command === "npm" && args[0] === "--version") return version;
      if (args[0] === "whoami") return "package-owner";
      if (command === "pnpm" && args[0] === "view") {
        if (unpublished.has(args[1])) throw new Error("404 Not Found");
        return "[]";
      }
      if (command === "pnpm" && args[0] === "publish") {
        const manifest = JSON.parse(
          readFileSync(`${options?.cwd}/package.json`, "utf8"),
        );
        manifests.push(manifest);
        if (!args.includes("--dry-run")) unpublished.delete(manifest.name);
        return "";
      }
      if (command === "npm" && args[0] === "trust" && args[1] === "list") {
        const config = trusted[args[2]];
        return config === undefined ? "" : JSON.stringify(config);
      }
      if (command === "npm" && args[0] === "trust" && args[1] === "github") {
        return "";
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  );
  return { commands, manifests };
};

beforeEach(() => {
  mocks.run.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("publishes only the missing FreeBSD placeholder under the bootstrap tag", async () => {
  const { commands, manifests } = createCommandMock({ missing: [arm64] });
  await bootstrapNativePackages({ freebsdOnly: true, publish: true });

  expect(manifests).toMatchObject([
    {
      name: arm64,
      version: "0.0.0-bootstrap.0",
      publishConfig: { access: "public" },
      files: ["README.md"],
    },
  ]);
  const publishes = commands.filter(({ args }) => args[0] === "publish");
  expect(publishes).toHaveLength(1);
  expect(publishes[0]?.args).toContain("--ignore-scripts");
  expect(publishes[0]?.args).toContain("bootstrap");
  expect(publishes[0]?.args).not.toContain("--dry-run");
  expect(commands.filter(({ args }) => args[0] === "trust")).toHaveLength(0);
});

test("bootstraps missing FreeBSD package and configures OIDC for both", async () => {
  const { commands } = createCommandMock({
    missing: [arm64],
    trusted: { [x64]: expectedTrust },
  });
  await bootstrapNativePackages({
    freebsdOnly: true,
    publish: true,
    configureOidc: true,
  });

  const trustCommands = commands.filter(({ args }) => args[0] === "trust");
  expect(trustCommands.map(({ args }) => args[1])).toEqual([
    "list",
    "github",
    "list",
  ]);
  const create = trustCommands.find(({ args }) => args[1] === "github");
  expect(create?.args).toEqual([
    "trust",
    "github",
    arm64,
    "--repo=nktnet1/sync-request-curl",
    "--file=publish.yaml",
    "--env=Production",
    "--allow-publish",
    "--yes",
    `--registry=${registry}`,
  ]);
  expect(
    commands.some(
      ({ command, args }) => command === "npm" && args[0] === "whoami",
    ),
  ).toBe(true);
});

test("configures existing FreeBSD packages without publishing placeholders", async () => {
  const { commands, manifests } = createCommandMock({
    trusted: { [arm64]: expectedTrust, [x64]: expectedTrust },
  });
  await bootstrapNativePackages({
    freebsdOnly: true,
    publish: true,
    configureOidc: true,
  });

  expect(manifests).toHaveLength(0);
  expect(commands.filter(({ args }) => args[1] === "github")).toHaveLength(0);
  expect(commands.filter(({ args }) => args[1] === "list")).toHaveLength(2);
});

test("dry run previews bootstrap and OIDC without requiring login or listing trust", async () => {
  const { commands, manifests } = createCommandMock({ missing: [arm64] });
  await bootstrapNativePackages({ freebsdOnly: true, configureOidc: true });

  expect(manifests).toHaveLength(1);
  expect(commands.filter(({ args }) => args[0] === "trust")).toHaveLength(0);
  expect(commands.filter(({ args }) => args[0] === "whoami")).toHaveLength(0);
  expect(
    commands.filter(({ args }) => args[0] === "publish")[0]?.args,
  ).toContain("--dry-run");
});

test("refuses to replace an existing different trusted publisher", async () => {
  const { commands } = createCommandMock({
    trusted: {
      [arm64]: { ...expectedTrust, environment: "Staging" },
      [x64]: expectedTrust,
    },
  });
  await expect(
    bootstrapNativePackages({
      freebsdOnly: true,
      publish: true,
      configureOidc: true,
    }),
  ).rejects.toThrow(/different trusted publisher/);
  expect(commands.filter(({ args }) => args[1] === "github")).toHaveLength(0);
  expect(commands.filter(({ args }) => args[1] === "revoke")).toHaveLength(0);
});

test("fails closed on trust-list errors", async () => {
  const { commands } = createCommandMock();
  mocks.run.mockImplementation((command: string, args: string[]) => {
    commands.push({ command, args });
    if (command === "npm" && args[0] === "--version") return "11.19.0";
    if (args[0] === "whoami") return "package-owner";
    if (args[0] === "view") return "[]";
    if (command === "npm" && args[1] === "list") {
      throw new Error("403 Forbidden");
    }
    throw new Error("Unexpected command");
  });
  await expect(
    bootstrapNativePackages({
      freebsdOnly: true,
      publish: true,
      configureOidc: true,
    }),
  ).rejects.toThrow(/Unable to check npm trusted publishers/);
  expect(commands.some(({ args }) => args[1] === "github")).toBe(false);
});

test("retries npm trust inspection interactively when browser 2FA is needed", async () => {
  const originalInput = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const originalOutput = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY",
  );
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  const commands: string[][] = [];
  let challenged = false;
  mocks.run.mockImplementation((command: string, args: string[]) => {
    commands.push([command, ...args]);
    if (command === "npm" && args[0] === "--version") return "11.19.0";
    if (args[0] === "whoami") return "package-owner";
    if (args[0] === "view") return "[]";
    if (command === "npm" && args[1] === "list") {
      if (args.includes("--json") && !challenged) {
        challenged = true;
        throw new Error("EOTP two-factor authentication required");
      }
      return args.includes("--json") ? JSON.stringify(expectedTrust) : "";
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });
  try {
    await bootstrapNativePackages({
      freebsdOnly: true,
      publish: true,
      configureOidc: true,
    });
    expect(
      commands.filter(
        ([, first, second]) => first === "trust" && second === "list",
      ),
    ).toHaveLength(4);
    expect(
      commands.some(
        ([, first, second]) => first === "trust" && second === "github",
      ),
    ).toBe(false);
  } finally {
    if (originalInput)
      Object.defineProperty(process.stdin, "isTTY", originalInput);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (originalOutput)
      Object.defineProperty(process.stdout, "isTTY", originalOutput);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  }
});

test("rejects obsolete npm versions before scanning or publishing", async () => {
  const { commands } = createCommandMock({ version: "11.14.9" });
  await expect(
    bootstrapNativePackages({
      freebsdOnly: true,
      publish: true,
      configureOidc: true,
    }),
  ).rejects.toThrow(/npm >= 11\.15\.0/);
  expect(commands).toHaveLength(1);
});

test("accepts npm 12 and rejects non-npm registries for OIDC", async () => {
  const valid = createCommandMock({ version: "12.2.1" });
  await bootstrapNativePackages({ freebsdOnly: true, configureOidc: true });
  expect(valid.commands.some(({ args }) => args[0] === "view")).toBe(true);

  mocks.run.mockClear();
  await expect(
    bootstrapNativePackages({
      freebsdOnly: true,
      publish: true,
      configureOidc: true,
      registry: "https://some-other-registry.example/",
    }),
  ).rejects.toThrow(/registry.npmjs.org/);
  expect(mocks.run).not.toHaveBeenCalled();
});

test("parses npm trust list JSON including separate pretty-printed objects", () => {
  expect(parseTrustedPublishers("\n")).toEqual([]);
  expect(parseTrustedPublishers(JSON.stringify(expectedTrust))).toEqual([
    expectedTrust,
  ]);
  expect(parseTrustedPublishers(JSON.stringify([expectedTrust]))).toEqual([
    expectedTrust,
  ]);
  expect(
    parseTrustedPublishers(
      `${JSON.stringify(expectedTrust, null, 2)}\n\n${JSON.stringify(
        {
          ...expectedTrust,
          id: "second-publisher",
        },
        null,
        2,
      )}\n`,
    ),
  ).toHaveLength(2);
  expect(() => parseTrustedPublishers("some unrelated output")).toThrow(
    /Invalid npm trust list JSON/,
  );
  expect(() => parseTrustedPublishers('{"type":"github"')).toThrow(
    /Incomplete npm trust list JSON/,
  );
});
