import {
  teardown as teardownDevServer,
} from 'jest-dev-server';

module.exports = async () => {
  globalThis.servers.forEach((child: any) => {
    child.kill('SIGINT');
  });

  await teardownDevServer(globalThis.servers);
};
