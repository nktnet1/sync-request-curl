import { stopServer } from 'sync-dev-server';

module.exports = async () => {
  stopServer(globalThis.server, 'SIGINT');
};
