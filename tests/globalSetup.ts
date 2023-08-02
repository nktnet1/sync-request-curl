import { setup as setupDevServer } from 'jest-dev-server';
import { HOST as host, PORT as port, DEBUG as debug } from './config';

module.exports = async () => {
  const command = 'npx jest tests/internal/server';
  globalThis.servers = await setupDevServer({
    host,
    port,
    debug,
    command,
    launchTimeout: 50 * 1000,
    usedPortAction: 'ignore',
  });
};
