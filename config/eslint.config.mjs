/**
 * Loom IDE — ESLint flat config (ESLint 9+).
 *
 * Scope (quality gate baseline): main, agent, shared, renderer (TS/TSX).
 *
 * NOTE on React-specific rules:
 *   The renderer was previously excluded from linting. We now bring it under
 *   typescript-eslint (catches `any`, unused vars, unsafe casts, etc.).
 *   React-specific rules (hooks, jsx-a11y) require plugins that are NOT
 *   installed in the offline sandbox. To enable them when network is available:
 *
 *     npm i -D @eslint-react/eslint-react eslint-plugin-react-hooks eslint-plugin-jsx-a11y
 *
 *   then import the presets and add a renderer block:
 *     import react from '@eslint-react/eslint-react';
 *     apply react.configs.recommended and enable 'react-hooks/rules-of-hooks'
 *     plus jsx-a11y rules for the renderer .ts/.tsx files.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const TS_SOURCES = [
  'src/main/**/*.{ts,tsx}',
  'src/agent/**/*.ts',
  'src/shared/**/*.ts',
  'src/renderer/**/*.{ts,tsx}',
];

export default tseslint.config(
  // Baseline: JS/TS recommended rules.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Apply to ALL our TS sources (renderer now included).
  {
    files: TS_SOURCES,
    rules: {
      // Allow '_' prefix for intentionally unused params (common in IPC handlers).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Type safety is the #1 lever for this team. `any` is treated as a
      // WARNING repo-wide (so CI stays green and we get a declining metric:
      // currently ~650 sites) and as an ERROR for NEW code via the pre-commit
      // gate (see eslint.config.staged.mjs + lint-staged). This is a ratchet:
      // once the repo-wide count drops below threshold, flip this to 'error'.
      // Rationale: with strict TS already on, residual `any` bypasses every
      // guarantee; blocking it only at the source prevents regressions while
      // the legacy backlog is cleaned incrementally.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow require() for dynamic imports used to break cycles.
      '@typescript-eslint/no-require-imports': 'off',
      // Allow empty catch blocks (common for best-effort operations).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Main process: console logging is expected.
  {
    files: ['src/main/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // React hooks rules for the renderer (plugin now installed).
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Tests: `any` is legitimate for mocking/stubs; keep it off to avoid churn.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Ignore build output and vendored modules.
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'src/renderer/node_modules/**',
      '*.js', // build artifacts at root (e.g. eslint.config.mjs itself)
      '!eslint.config.mjs',
    ],
  },
);
