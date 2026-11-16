import { createServer } from "node:net";

/**
 * Ask the OS for an unused IPv4 loopback TCP port, then release it.
 *
 * Intended for tests and local tooling that need a best-effort free port.
 */
export const reserveLoopbackPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a loopback port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
