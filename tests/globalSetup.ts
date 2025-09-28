import { startServer, stopServer } from 'sync-dev-server';
import { HOST as host, PORT as port } from './app/config';

/**
 * Starts and stops a server for HTTP testing
 */
export default function setup() {
  const command = 'pnpm start';
  console.log(`[VITEST] Attempting to start server with ${command} in ${__filename}`);
  const server = startServer(command, {
    host,
    port,
    debug: true,
    timeout: 5 * 1000,
    usedPortAction: 'ignore',
  });

  return () => {
    stopServer(server, 'SIGINT');
  };
}
