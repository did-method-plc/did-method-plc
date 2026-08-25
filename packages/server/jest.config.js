module.exports = /** @type {import('jest').Config} */ ({
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  transformIgnorePatterns: [`<rootDir>/node_modules/(?!get-port|node-fetch)`],
  testRegex: '(/tests/.*.(test|spec)).(jsx?|tsx?)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
  testTimeout: 30000,
  displayName: 'server',
})
