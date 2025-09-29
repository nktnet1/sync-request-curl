import request from '../src';
import { startServer, stopServer } from 'sync-dev-server';
import { HOST as host, PORT as port } from './app/config';

/**
 * Starts and stops a server for HTTP testing
 */
export default function setup() {
  const command = 'pnpm start';
  const server = startServer(command, {
    host,
    port,
    debug: true,
    timeout: 5 * 1000,
    usedPortAction: 'ignore',
    isServerReadyFn: () => {
      try {
        const response = request('GET', `http://${host}:${port}`);
        return Boolean(response.getJSON('utf-8').message);
      } catch {
        return false;
      }
    },
  });

  return () => {
    stopServer(server, 'SIGINT');
  };
}
