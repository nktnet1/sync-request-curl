import { setup } from 'jest-dev-server';

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

declare global {
  // eslint-disable-next-line no-var
  var servers: UnwrapPromise<ReturnType<typeof setup>>;
}
