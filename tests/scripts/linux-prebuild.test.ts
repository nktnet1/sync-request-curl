import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  getLinuxLibc: vi.fn(),
}));
vi.mock("#scripts/process", () => ({ run: mocks.run }));
vi.mock("node:fs", async () => ({
  ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
}));
vi.mock("#scripts/native-platform", async () => ({
  ...(await vi.importActual<typeof import("#scripts/native-platform")>(
    "#scripts/native-platform",
  )),
  getLinuxLibc: mocks.getLinuxLibc,
}));

const root = resolve(import.meta.dirname, "../..");
const originalArgv = process.argv;
const originalPlatform = process.platform;
const originalArch = process.arch;

beforeEach(() => {
  mocks.run.mockReset();
  mocks.existsSync.mockReset().mockReturnValue(true);
  mocks.mkdirSync.mockReset();
  mocks.getLinuxLibc.mockReset().mockReturnValue("musl");
});

afterEach(() => {
  process.argv = originalArgv;
  Object.defineProperty(process, "platform", { value: originalPlatform });
  Object.defineProperty(process, "arch", { value: originalArch });
  vi.unstubAllEnvs();
  vi.resetModules();
});

test.each(["gnu", "musl"])(
  "isolates host native build directories in %s test containers",
  async (libc) => {
    process.argv = [
      process.execPath,
      "scripts/linux-prebuild.ts",
      `--libc=${libc}`,
      "--mode=test",
    ];
    await import("#scripts/linux-prebuild");
    expect(mocks.run).toHaveBeenCalledOnce();
    const [command, args] = mocks.run.mock.calls[0];
    expect(command).toBe("docker");
    expect(args).toEqual(
      expect.arrayContaining([
        "type=volume,destination=/workspace/native/build",
        "type=volume,destination=/workspace/native/target",
        "type=volume,destination=/workspace/node_modules",
        `--libc=${libc}`,
        "--mode=test",
      ]),
    );
  },
);

test("pins musl tests to the prebuild even when the host environment selects another addon", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
  vi.stubEnv("SYNC_REQUEST_CURL_NATIVE_PATH", "/host/native/build/addon.node");
  process.argv = [
    process.execPath,
    "scripts/linux-prebuild.ts",
    "--libc=musl",
    "--mode=test",
    "--inside",
  ];
  await import("#scripts/linux-prebuild");
  const prebuild = join(
    root,
    "prebuilds",
    "sync_request_curl_native.linux-x64-musl.node",
  );
  expect(mocks.existsSync).toHaveBeenCalledWith(prebuild);
  expect(mocks.run).toHaveBeenLastCalledWith(
    "pnpm",
    ["test"],
    expect.objectContaining({
      cwd: root,
      env: expect.objectContaining({ SYNC_REQUEST_CURL_NATIVE_PATH: prebuild }),
    }),
  );
});

test("fails before installing dependencies if the requested prebuild is missing", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
  mocks.existsSync.mockReturnValue(false);
  process.argv = [
    process.execPath,
    "scripts/linux-prebuild.ts",
    "--libc=musl",
    "--mode=test",
    "--inside",
  ];
  await expect(import("#scripts/linux-prebuild")).rejects.toThrow(
    "Missing prebuild for container test",
  );
  expect(mocks.run).not.toHaveBeenCalled();
});
