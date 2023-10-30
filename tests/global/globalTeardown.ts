import { stopServer } from 'sync-dev-server';

module.exports = () => {
  stopServer(globalThis.server, 'SIGINT');
};
