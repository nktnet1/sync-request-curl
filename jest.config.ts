import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 1,
  globalSetup: '<rootDir>/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/globalTeardown.ts',
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  forceExit: false,
  detectOpenHandles: true,
  transform: {
    '^.+\\.(ts|tsx|js)$': 'ts-jest'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: ['src/**/*.ts', '!tests'],
};

export default config;
