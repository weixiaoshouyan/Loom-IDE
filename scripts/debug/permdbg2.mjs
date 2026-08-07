import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-perm-root-'));
const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-perm-target-'));
const linkDir = path.join(root, 'escape-junction');
try { fs.symlinkSync(targetDir, linkDir, 'junction'); } catch (e) { console.log('junction FAILED:', e.message); process.exit(0); }
console.log('junction OK');
console.log('root      =', root);
console.log('targetDir =', targetDir);
console.log('linkDir   =', linkDir);
console.log('realpath(linkDir) =', (() => { try { return fs.realpathSync(linkDir); } catch (e) { return 'ERR ' + e.message; } })());

function normalize(p) { return path.resolve(p); }
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
function resolveRealPath(inputPath) {
  const resolved = path.resolve(inputPath);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}
function matchesAnyRoot(roots, p) { for (const r of roots) { if (isInside(r, p)) return true; } return false; }
const roots = new Set([normalize(root)]);
const resolved = normalize(linkDir);
const lexicalOk = roots.has(resolved) || matchesAnyRoot(roots, resolved);
const real = resolveRealPath(resolved);
console.log('lexicalOk =', lexicalOk, '| real =', real, '| real===resolved =', real === resolved);
console.log('matchesAnyRoot(real) =', matchesAnyRoot(roots, real));
console.log('canAccess(linkDir) =>', (() => {
  if (!lexicalOk) return false;
  if (real === resolved) return true;
  return roots.has(real) || matchesAnyRoot(roots, real);
})());
