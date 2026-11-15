import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reserveLoopbackPort } from "#scripts/loopback-port";
import { pollUntilReady } from "#scripts/poll-until-ready";

export const launchSmokeServer = async (
  temporaryRoot: string,
  onStart: (child: ChildProcess) => void,
): Promise<string> => {
  const port = await reserveLoopbackPort();
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

  let smokeServerOutput = "";
  const serverProcess = spawn(process.execPath, [serverPath, String(port)], {
    cwd: temporaryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  onStart(serverProcess);
  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    smokeServerOutput += chunk.toString();
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    smokeServerOutput += chunk.toString();
  });

  const ready = await pollUntilReady(
    async () => {
      if (serverProcess.exitCode !== null) {
        throw new Error(
          `Request smoke server exited before becoming ready${
            smokeServerOutput.trim() ? `:\n${smokeServerOutput.trim()}` : ""
          }`,
        );
      }
      try {
        const response = await fetch(`${serverUrl}/health`);
        return response.status === 204;
      } catch {
        // The request smoke server is still starting.
        return false;
      }
    },
    50,
    Date.now() + 10_000,
  );
  if (!ready) {
    throw new Error(
      `Timed out waiting for request smoke server at ${serverUrl}`,
    );
  }
  return serverUrl;
};
