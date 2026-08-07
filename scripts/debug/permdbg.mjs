import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-perm-root-'));
const outside = path.join(os.tmpdir(), 'loom-perm-outside-' + process.pid + '.txt');
fs.writeFileSync(outside, 'secret', 'utf-8');
const link = path.join(root, 'escape-link');
try { fs.symlinkSync(outside, link); } catch (e) { console.log('symlink FAILED:', e.message); process.exit(0); }
console.log('symlink OK');
console.log('root     =', root);
console.log('outside  =', outside);
console.log('link     =', link);
console.log('realpath(link) =', (() => { try { return fs.realpathSync(link); } catch (e) { return 'ERR ' + e.message; } })());

function normalize(p) { return path.resolve(p); }
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
function resolveRealPath(inputPath) {
  const resolved = path.resolve(inputPath);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}
function matchesAnyRoot(roots, p) {
  for (const r of roots) { if (isInside(r, p)) return true; } return false;
}
const roots = new Set([normalize(root)]);
const resolved = normalize(link);
const lexicalOk = roots.has(resolved) || matchesAnyRoot(roots, resolved);
const real = resolveRealPath(resolved);
console.log('lexicalOk =', lexicalOk, '| real =', real, '| real===resolved =', real === resolved);
console.log('matchesAnyRoot(real) =', matchesAnyRoot(roots, real));
console.log('canAccess(link) =>', lexicalOk ? (real === resolved ? true : (roots.has(real) || matchesAnyRoot(roots, real))) : false);
