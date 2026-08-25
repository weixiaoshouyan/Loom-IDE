import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

function collectKeys(obj: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>();
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') {
        for (const sub of collectKeys(v, full)) keys.add(sub);
      } else {
        keys.add(full);
      }
    }
  }
  return keys;
}

const ROOT = join(__dirname, '../../renderer');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

function usedTKeys(): string[] {
  const keys: string[] = [];
  for (const file of walk(ROOT)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const src = readFileSync(file, 'utf8');
    const tkRe = /\btk\(\s*'([a-zA-Z][\w.]*)'/g;
    let m: RegExpExecArray | null;
    while ((m = tkRe.exec(src)) !== null) keys.push(`settings.${m[1]}`);
    const tRe = /\bt\(\s*'([a-zA-Z][\w.]*)'/g;
    while ((m = tRe.exec(src)) !== null) keys.push(m[1]);
  }
  return keys;
}

describe('i18n coverage', () => {
  it('every t() key used in renderer exists in both zh-CN and en-US', () => {
    const zhKeys = collectKeys(zhCN);
    const enKeys = collectKeys(enUS);
    const used = new Set(usedTKeys());
    expect(used.size).toBeGreaterThan(50);
    const missingZh: string[] = [];
    const missingEn: string[] = [];
    for (const key of used) {
      if (!zhKeys.has(key)) missingZh.push(key);
      if (!enKeys.has(key)) missingEn.push(key);
    }
    expect(missingZh, `missing in zh-CN: ${missingZh.join(', ')}`).toEqual([]);
    expect(missingEn, `missing in en-US: ${missingEn.join(', ')}`).toEqual([]);
  });

  it('zh-CN and en-US tables have identical key structures', () => {
    const zhKeys = [...collectKeys(zhCN)].sort();
    const enKeys = [...collectKeys(enUS)].sort();
    const onlyZh = zhKeys.filter(k => !enKeys.includes(k));
    const onlyEn = enKeys.filter(k => !zhKeys.includes(k));
    expect(onlyZh, `keys only in zh-CN: ${onlyZh.join(', ')}`).toEqual([]);
    expect(onlyEn, `keys only in en-US: ${onlyEn.join(', ')}`).toEqual([]);
  });
});
