import { teardown } from 'jest-dev-server';

module.exports = async () => {
  globalThis.servers.forEach(child => child.kill('SIGINT'));
  await teardown(globalThis.servers);
};
