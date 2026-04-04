/** @type {import('jest').Config} */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: ['**/*.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'app.controller.spec.ts'],
  moduleNameMapper: {
    '^@api/(.*)$': '<rootDir>/$1',
    '^@lucky/shared$':
      '<rootDir>/../../../node_modules/@lucky/shared/dist/index.js',
  },
};

module.exports = config;

