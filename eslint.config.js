// ESLint configuration for the whole repository. Defines browser, Node, and test globals plus lint rules.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/',
      'build/',
      'node_modules/',
      'coverage/',
      '.husky/_/',
      '*.js.map',
    ],
  },
  {
    ...js.configs.recommended,
  },
  {
    files: ['src/**/*.js', 'src/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.es2021,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-func-assign': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/content/**/*.js'],
    rules: {
      'no-undef': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
