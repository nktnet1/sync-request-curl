import { startServer } from 'sync-dev-server';
import { HOST as host, PORT as port } from '../app/config';

module.exports = async () => {
  const command = 'npm run start';
  globalThis.server = startServer(command, {
    host,
    port,
    debug: false,
    timeout: 50 * 1000,
    usedPortAction: 'ignore',
  });
};
