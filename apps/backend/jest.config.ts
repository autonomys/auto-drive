const { createDefaultEsmPreset } = require('ts-jest')

module.exports = {
  ...createDefaultEsmPreset(),
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // Jest's ESM mode never frees a finished test file's modules
  // (jestjs/jest#14605), so memory grows with every suite. One worker keeps the
  // suites serial; recycling it bounds the leak.
  maxWorkers: 1,
  workerIdleMemoryLimit: '3GB',
  testMatch: ['**/__tests__/**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coveragePathIgnorePatterns: [
    './__tests__/utils/',
    './node_modules/',
    './migrations/',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
}
