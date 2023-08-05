import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 1,
  globalSetup: '<rootDir>/tests/global/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/global/globalTeardown.ts',
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
