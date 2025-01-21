module.exports = {
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  testMatch: ["**/__tests__/**/*.spec.ts"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  coveragePathIgnorePatterns: [
    "./__tests__/utils/",
    "./node_modules/",
    "./migrations/",
  ],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig.test.json" }],
  },
};
