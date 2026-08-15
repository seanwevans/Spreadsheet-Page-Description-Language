/**
 * Lint configuration for the JavaScript in this repository.
 *
 * The renderers are not ordinary Node modules — `spdlrender.gs` runs in Apps
 * Script, `spdl-parser.js` is a UMD bundle that has to load in both Node and
 * a browser, and `docs/playground.html` is a browser page — so each gets the
 * globals it actually has rather than one permissive setting for everything.
 */
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'tests/golden/**'],
  },
  js.configs.recommended,
  {
    // Node-side tooling: the linter, the Airtable renderer, scripts, tests.
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // The reference parser is a UMD bundle: it must work as a CommonJS module
    // and as a browser <script>, so it sees both sets of globals.
    files: ['spdl-parser.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Apps Script: a script (not a module) with Google's globals injected by
    // the runtime. Top-level functions are entry points, not dead code.
    files: ['**/*.gs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        SpreadsheetApp: 'readonly',
        Logger: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', args: 'after-used' }],
      'no-console': 'off',
    },
  },
];
