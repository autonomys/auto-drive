import type { Config } from 'jest'

const config: Config = {
  testMatch: ['**/__tests__/**/*.spec.ts'],
  // Resolve baseUrl ("./src") path aliases so Jest can find modules that the
  // TypeScript compiler resolves through tsconfig's baseUrl/paths settings.
  moduleNameMapper: {
    // @/* → src/* (tsconfig paths alias)
    '^@/(.+)$': '<rootDir>/src/$1',
    // Bare non-scoped imports that go through baseUrl (e.g. "utils/auth",
    // "services/api", "contexts/network", etc.) → src/<path>
    '^(utils|services|contexts|globalStates|components|hooks|app)/(.+)$':
      '<rootDir>/src/$1/$2',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          // ES2020 required for BigInt literal syntax (0n, 1024n, etc.)
          target: 'ES2020',
          lib: ['ES2020'],
          types: ['jest', 'node'],
        },
      },
    ],
  },
  testEnvironment: 'node',
}

export default config
