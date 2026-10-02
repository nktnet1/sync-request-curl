import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const readyTimeoutMs = 5_000;
const stopTimeoutMs = 5_000;
const security = "/usr/bin/security";
const systemKeychain = "/Library/Keychains/System.keychain";
const serverMode = process.env.APPLE_SECTRUST_E2E_SERVER === "1";

type ReadyMessage = {
  type: "ready";
  port: number;
};

const run = (
  command: string,
  args: string[],
  options: { allowFailure?: boolean; capture?: boolean } = {},
): string => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}` +
        (result.stderr ? `:\n${result.stderr}` : ""),
    );
  }
  return result.stdout?.trim() ?? "";
};

const runServer = async (): Promise<void> => {
  const cert = process.env.APPLE_SECTRUST_E2E_CERT;
  const key = process.env.APPLE_SECTRUST_E2E_KEY;
  if (!cert || !key) {
    throw new Error("Apple SecTrust E2E server certificate paths are missing");
  }

  const server = createServer(
    {
      cert: readFileSync(cert),
      key: readFileSync(key),
    },
    (request, response) => {
      if (request.method === "GET" && request.url === "/redirect") {
        response.writeHead(302, { location: "/final" });
        response.end();
        return;
      }

      if (request.method === "GET" && request.url === "/final") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    },
  );

  server.listen(0, host, () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new TypeError("Apple SecTrust E2E server has no TCP address");
    }
    process.send?.({
      type: "ready",
      port: address.port,
    } satisfies ReadyMessage);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await once(server, "close");
};

const createCertificates = (
  directory: string,
): {
  rootCert: string;
  serverCert: string;
  serverKey: string;
} => {
  const rootConfig = join(directory, "root.cnf");
  const rootKey = join(directory, "root-key.pem");
  const rootCert = join(directory, "root-cert.pem");
  const serverConfig = join(directory, "server.cnf");
  const serverKey = join(directory, "server-key.pem");
  const serverRequest = join(directory, "server.csr");
  const serverCert = join(directory, "server-cert.pem");

  writeFileSync(
    rootConfig,
    `[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = v3_ca\n\n[dn]\nCN = sync-request-curl Apple SecTrust E2E Root\n\n[v3_ca]\nbasicConstraints = critical, CA:TRUE, pathlen:0\nkeyUsage = critical, keyCertSign, cRLSign\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid:always, issuer\n`,
  );
  writeFileSync(
    serverConfig,
    `[req]\ndistinguished_name = dn\nprompt = no\n\n[dn]\nCN = localhost\n\n[v3_server]\nbasicConstraints = critical, CA:FALSE\nkeyUsage = critical, digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @alt_names\nsubjectKeyIdentifier = hash\nauthorityKeyIdentifier = keyid, issuer\n\n[alt_names]\nDNS.1 = localhost\nIP.1 = 127.0.0.1\n`,
  );

  run(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-keyout",
      rootKey,
      "-out",
      rootCert,
      "-config",
      rootConfig,
    ],
    { capture: true },
  );
  run(
    "/usr/bin/openssl",
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-keyout",
      serverKey,
      "-out",
      serverRequest,
      "-config",
      serverConfig,
    ],
    { capture: true },
  );
  run(
    "/usr/bin/openssl",
    [
      "x509",
      "-req",
      "-in",
      serverRequest,
      "-CA",
      rootCert,
      "-CAkey",
      rootKey,
      "-CAcreateserial",
      "-days",
      "1",
      "-sha256",
      "-extfile",
      serverConfig,
      "-extensions",
      "v3_server",
      "-out",
      serverCert,
    ],
    { capture: true },
  );

  return { rootCert, serverCert, serverKey };
};

const waitForServer = (server: ReturnType<typeof fork>): Promise<number> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Apple SecTrust E2E server"));
    }, readyTimeoutMs);
    timeout.unref();

    const cleanup = (): void => {
      clearTimeout(timeout);
      server.off("message", onMessage);
      server.off("exit", onExit);
    };
    const onMessage = (message: unknown): void => {
      if (
        typeof message !== "object" ||
        message === null ||
        (message as Partial<ReadyMessage>).type !== "ready" ||
        !Number.isInteger((message as Partial<ReadyMessage>).port)
      ) {
        return;
      }
      cleanup();
      resolve((message as ReadyMessage).port);
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      cleanup();
      reject(
        new Error(
          `Apple SecTrust E2E server exited before ready (code=${code}, signal=${signal})`,
        ),
      );
    };

    server.on("message", onMessage);
    server.on("exit", onExit);
  });

const stopServer = async (server: ReturnType<typeof fork>): Promise<void> => {
  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), stopTimeoutMs);
      timeout.unref();
    }),
  ]);
  if (exited) {
    return;
  }
  server.kill("SIGKILL");
  await once(server, "exit");
};

const runTest = async (): Promise<void> => {
  if (process.platform !== "darwin") {
    throw new Error("Apple SecTrust end-to-end test requires macOS");
  }

  const directory = mkdtempSync(join(tmpdir(), "sync-request-curl-sectrust-"));
  const { rootCert, serverCert, serverKey } = createCertificates(directory);
  const serverPath = fileURLToPath(import.meta.url);
  const server = fork(serverPath, [], {
    env: {
      ...process.env,
      APPLE_SECTRUST_E2E_CERT: serverCert,
      APPLE_SECTRUST_E2E_KEY: serverKey,
      APPLE_SECTRUST_E2E_SERVER: "1",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let trusted = false;

  try {
    const port = await waitForServer(server);
    const redirectUrl = `https://${host}:${port}/redirect`;
    const finalUrl = `https://${host}:${port}/final`;

    for (const variable of [
      "CURL_CA_BUNDLE",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ]) {
      delete process.env[variable];
    }
    process.env.NO_PROXY = "127.0.0.1,localhost";
    process.env.no_proxy = "127.0.0.1,localhost";
    delete process.env.SYNC_REQUEST_CURL_NATIVE_PATH;

    const { default: request } = await import("sync-request-curl");

    assert.throws(
      () => request("GET", finalUrl),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as Error & { code?: number }).code === 60,
      "The generated CA must be untrusted before it is added to macOS Keychain",
    );

    run("/usr/bin/sudo", [
      security,
      "add-trusted-cert",
      "-d",
      "-r",
      "trustRoot",
      "-p",
      "ssl",
      "-k",
      systemKeychain,
      rootCert,
    ]);
    trusted = true;

    run(
      security,
      ["verify-cert", "-c", serverCert, "-p", "ssl", "-s", "localhost", "-L"],
      { capture: true },
    );

    const redirected = request("GET", redirectUrl);
    assert.equal(redirected.statusCode, 200);
    assert.deepEqual(redirected.getJSON(), { ok: true });

    const notRedirected = request("GET", redirectUrl, {
      followRedirects: false,
    });
    assert.equal(notRedirected.statusCode, 302);

    console.log(
      "Apple SecTrust end-to-end test passed: a Keychain-only root trusted a local HTTPS redirect through the built package.",
    );
  } finally {
    await stopServer(server);
    if (trusted) {
      run("/usr/bin/sudo", [security, "remove-trusted-cert", "-d", rootCert], {
        allowFailure: true,
        capture: true,
      });
    }
    rmSync(directory, { force: true, recursive: true });
  }
};

if (serverMode) {
  await runServer();
} else {
  await runTest();
}
