const { createDefaultEsmPreset } = require('ts-jest')

module.exports = {
  ...createDefaultEsmPreset(),
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  testMatch: ['**/__tests__/**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
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
