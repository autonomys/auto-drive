import type { Config } from 'jest';

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
    // @auto-drive/models → the TypeScript SOURCE of its user/payment types.
    //
    // Two problems, one mapper. The package publishes ESM ("export * from …")
    // and this suite runs under CommonJS, so requiring its build output throws
    // `SyntaxError: Unexpected token 'export'` — which is what importing a
    // shared enum from a unit test used to cost. And its top-level barrel
    // re-exports `objects/`, which reaches @autonomys/auto-dag-data: another ESM
    // package, in node_modules, where the same failure recurs one level down.
    //
    // So this points at `users/`, which is self-contained (zod only) and holds
    // every runtime value the frontend actually branches on — PaymentMethod,
    // IntentStatus, UsdcClosedReason. TYPES are unaffected: ts-jest resolves
    // them through the package's own declarations, since moduleNameMapper is a
    // runtime concern. A future test needing a runtime value from `objects/`
    // will need this widened, which is a smaller surprise than the SyntaxError.
    '^@auto-drive/models$':
      '<rootDir>/../../packages/models/src/users/index.ts',
    // @auto-drive/ui → its constants SOURCE, for the same reason: the package
    // ships ESM ("export * from …") and its built barrel also pulls in the React
    // component tree, which no unit test here renders. `constants/` is the half
    // the logic under test imports — chain definitions, ABIs, routes.
    '^@auto-drive/ui$': '<rootDir>/../../packages/ui/src/constants/index.ts',
    // The shared packages are ESM and write their relative imports with the
    // mandatory `.js` extension, which under CommonJS resolution names a file
    // that does not exist in source form. Stripping it lets the resolver find
    // the `.ts`. Scoped to relative paths, and the frontend's own code imports
    // without extensions, so nothing here is affected.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
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
          // DOM alongside it: the hook specs run under jsdom (a per-file
          // `@jest-environment` docblock) and the code they exercise reaches
          // sessionStorage and React.
          lib: ['ES2020', 'DOM'],
          jsx: 'react-jsx',
          types: ['jest', 'node'],
        },
      },
    ],
  },
  // Node by default — most of this suite is pure functions, and jsdom costs a
  // second of startup per file. The specs that drive a React hook opt in with a
  // `@jest-environment jsdom` docblock.
  testEnvironment: 'node',
};

export default config;
