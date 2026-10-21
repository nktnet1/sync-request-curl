import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs, styleText } from "node:util";
import { Worker } from "node:worker_threads";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
  },
});

if (!values.file) {
  throw new Error("--file must point to a native addon");
}

const file = resolve(values.file);
if (!existsSync(file)) {
  throw new Error(`Native addon does not exist: ${file}`);
}

interface NativeHttpResponse {
  transportCode: number;
  transportMessage: string;
  statusCode: number;
  body: Buffer;
}

interface NativeHttpBinding {
  request(options: {
    method: string;
    url: string;
    headers: string[];
    timeout: number;
    connectTimeout: number;
    overallTimeout: number;
    socketTimeout: number;
    noBody: boolean;
  }): NativeHttpResponse;
}

const nativeRequire = createRequire(import.meta.url);
const binding = nativeRequire(file) as NativeHttpBinding;
assert.equal(typeof binding.request, "function");

// The HTTP server must run on a separate thread: the native request blocks
// this thread until the response is received.
const server = new Worker(
  new URL("./verify-native-http-server.cjs", import.meta.url),
);

try {
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.once("message", (value: unknown) => {
      if (typeof value !== "number") {
        rejectPort(new TypeError("HTTP worker did not provide a port"));
        return;
      }
      resolvePort(value);
    });
    server.once("error", rejectPort);
    server.once("exit", (code) => {
      rejectPort(new Error(`HTTP worker exited before startup (${code})`));
    });
  });

  const response = binding.request({
    method: "GET",
    url: `http://127.0.0.1:${port}/verify`,
    headers: [],
    timeout: 5000,
    connectTimeout: 5000,
    overallTimeout: 5000,
    socketTimeout: 5000,
    noBody: false,
  });

  assert.equal(response.transportCode, 0, response.transportMessage);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body.toString()), { ok: true });
  console.log(`${styleText("green", "Verified")} native HTTP request: ${file}`);
} finally {
  await server.terminate();
}
