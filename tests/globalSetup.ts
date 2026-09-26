import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as v from "valibot";
import { HOST as host, PORT as port } from "#tests/app/config";

const root = resolve(import.meta.dirname, "..");
const serverUrl = `http://${host}:${port}`;
const SERVER_READY_MESSAGE = "sync-request-curl:test-server-ready";
const SERVER_START_TIMEOUT_MS = 5_000;
const SERVER_STOP_TIMEOUT_MS = 5_000;
const healthResponseSchema = v.object({ message: v.optional(v.string()) });

let testServer: ChildProcess | undefined;

const isServerReady = async (): Promise<boolean> => {
  try {
    const response = await fetch(serverUrl);
    if (!response.ok) {
      return false;
    }
    const body = v.parse(healthResponseSchema, await response.json());
    return body.message === "Hello, world!";
  } catch {
    return false;
  }
};

const waitForServer = async (server: ChildProcess): Promise<void> => {
  await Promise.race([
    once(server, "message").then(([message]) => {
      if (message !== SERVER_READY_MESSAGE) {
        const receivedMessage =
          typeof message === "string"
            ? message
            : `non-string message (${typeof message})`;
        throw new Error(
          `Unexpected test server IPC message: ${receivedMessage}`,
        );
      }
    }),
    once(server, "exit").then(([code, signal]) => {
      throw new Error(
        `Test server exited before becoming ready (code=${code}, signal=${signal})`,
      );
    }),
    delay(SERVER_START_TIMEOUT_MS, undefined, { ref: false }).then(() => {
      throw new Error(`Timed out waiting for test server at ${serverUrl}`);
    }),
  ]);
};

const waitForExit = (server: ChildProcess): Promise<boolean> => {
  if (server.exitCode !== null || server.signalCode !== null) {
    return Promise.resolve(true);
  }
  return Promise.race([
    once(server, "exit").then(() => true),
    delay(SERVER_STOP_TIMEOUT_MS, undefined, { ref: false }).then(() => false),
  ]);
};

const stopServer = async (server: ChildProcess): Promise<void> => {
  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  if (await waitForExit(server)) {
    return;
  }

  server.kill("SIGKILL");
  await once(server, "exit");
};

/**
 * Starts the local servers used by the HTTP integration tests.
 */
export async function setup(): Promise<void> {
  if (await isServerReady()) {
    return;
  }

  const server = spawn(
    process.execPath,
    ["--import", "tsx", "tests/app/server.ts"],
    {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    },
  );

  try {
    await waitForServer(server);
  } catch (error) {
    await stopServer(server);
    throw error;
  }

  testServer = server;
}

/**
 * Stops the local Hono server started by {@link setup}.
 */
export async function teardown(): Promise<void> {
  if (!testServer) {
    return;
  }

  const server = testServer;
  testServer = undefined;
  await stopServer(server);
}
