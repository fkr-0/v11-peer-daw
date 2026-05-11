/** @type {import('jest').Config} */
export default {
  preset: 'jest-preset-biome',
  // Or if you're not using jest-preset-biome:
  testEnvironment: 'node',
  transform: {},
  extensionsToTreatAsEsm: ['.ts', '.tsx', '.js', '.jsx'],
  moduleNameMapper: {
    '^(\\.{1,}/[^\\.]+)\\.(js|jsx)$': '$1',
  },
  testMatch: ['**/tests/**/*.test.js', '**/__tests__/**/*.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/vendor/**', '!src/**/*.test.js'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  verbose: true,
};
