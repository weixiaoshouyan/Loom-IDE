/**
 * Loom IDE — ESLint config for the pre-commit (lint-staged) gate.
 *
 * This is the HARD gate: it lints ONLY the files a developer is committing
 * (lint-staged passes the staged file list), and treats `any` as an ERROR so
 * new `any` cannot enter the codebase. The repo-wide eslint.config.mjs keeps
 * `any` as a warning to avoid a permanently-red CI while the legacy backlog
 * (~650 sites) is cleaned. Once that backlog clears, flip the repo-wide rule
 * to 'error' and this staged config can be retired.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const TS_SOURCES = [
  'src/main/**/*.{ts,tsx}',
  'src/agent/**/*.ts',
  'src/shared/**/*.ts',
  'src/renderer/**/*.{ts,tsx}',
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: TS_SOURCES,
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // HARD GATE: no new `any` in committed code.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    files: ['src/main/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'src/renderer/node_modules/**',
      '*.js',
      '!eslint.config.mjs',
      '!eslint.config.staged.mjs',
    ],
  },
);
