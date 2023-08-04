import { ChildProcessWithoutNullStreams } from 'child_process';
import { teardown as teardownDevServer } from 'jest-dev-server';

interface SpawndChildProcess extends ChildProcessWithoutNullStreams {
  destroy: () => Promise<void>;
}

module.exports = async () => {
  globalThis.servers.forEach((child: SpawndChildProcess) => {
    child.kill('SIGINT');
  });

  await teardownDevServer(globalThis.servers);
};
