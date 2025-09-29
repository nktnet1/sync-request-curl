import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
    },
  }
});
