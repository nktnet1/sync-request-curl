import { ChildProcess } from 'child_process';

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

declare global {
  // eslint-disable-next-line no-var
  var server: ChildProcess | null;
}
