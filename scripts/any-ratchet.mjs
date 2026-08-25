/**
 * Loom IDE — `no-explicit-any` ratchet.
 *
 * Enforces that the repository-wide count of explicit `any` never grows above
 * the recorded baseline, and lowers the baseline automatically when the count
 * drops (one-way ratchet). Complements the pre-commit staged gate: the hook
 * blocks new `any` in changed files; this catches any growth anywhere else
 * (renames, moves, generated code, config drift).
 *
 * Usage:
 *   node scripts/any-ratchet.mjs            # enforce baseline
 *   node scripts/any-ratchet.mjs --reset    # re-baseline to current count
 *
 * Baseline lives in package.json as `"anyBaseline": <n>`.
 * Exit codes: 0 = at or below baseline (baseline updated if improved),
 *             1 = above baseline (CI must fail).
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(projectRoot, 'package.json');
const reset = process.argv.includes('--reset');

function currentCount() {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'count-eslint-any.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const n = parseInt(out.trim().split(/\r?\n/).pop() || '', 10);
  if (!Number.isFinite(n)) throw new Error(`Unparseable counter output: ${out}`);
  return n;
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const baseline = typeof pkg.anyBaseline === 'number' ? pkg.anyBaseline : null;
const count = currentCount();

if (baseline === null || reset) {
  pkg.anyBaseline = count;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[any-ratchet] baseline set to ${count}`);
  process.exit(0);
}

if (count > baseline) {
  console.error(`[any-ratchet] FAIL: ${count} explicit \`any\` > baseline ${baseline}.`);
  console.error('Remove the new `any`s (or tighten types). Do NOT raise the baseline.');
  process.exit(1);
}

if (count < baseline) {
  pkg.anyBaseline = count;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[any-ratchet] improved: ${count} < ${baseline}; baseline lowered.`);
} else {
  console.log(`[any-ratchet] OK: ${count} == baseline ${baseline}`);
}
