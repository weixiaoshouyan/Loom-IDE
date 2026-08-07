/**
 * Loom IDE — cross-platform `no-explicit-any` counter.
 *
 * Replaces the old `grep -c` pipeline (Unix-only) so the metric works on
 * Windows cmd, PowerShell, and POSIX shells alike. Uses the ESLint 9 Node
 * API with the same config and scope as `npm run lint` so the number cannot
 * drift from what CI actually lints.
 *
 * Usage:  node scripts/count-eslint-any.mjs
 * Output: <count> (exit 0 always — informational metric, not a gate)
 */
import { ESLint } from 'eslint';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SCOPES = [
  'src/main/**/*.{ts,tsx}',
  'src/agent/**/*.ts',
  'src/shared/**/*.ts',
  'src/renderer/**/*.{ts,tsx}',
];

const eslint = new ESLint({
  cwd: projectRoot,
  overrideConfigFile: path.join(projectRoot, 'config', 'eslint.config.mjs'),
});

const results = await eslint.lintFiles(SCOPES);
const count = results.reduce(
  (sum, r) =>
    sum + r.messages.filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any').length,
  0,
);

console.log(String(count));
process.exit(0);
