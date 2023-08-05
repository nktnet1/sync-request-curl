import { setup } from 'jest-dev-server';
import { HOST as host, PORT as port, DEBUG as debug } from '../app/config';

module.exports = async () => {
  const command = 'npm run start';
  globalThis.servers = await setup({
    host,
    port,
    debug,
    command,
    launchTimeout: 50 * 1000,
    usedPortAction: 'ignore',
  });
};
