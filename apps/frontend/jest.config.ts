import type { Config } from 'jest'

const config: Config = {
  testMatch: ['**/__tests__/**/*.spec.ts'],
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
