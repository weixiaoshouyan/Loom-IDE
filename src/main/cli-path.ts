/**
 * CLI / loom:// 协议路径解析（纯函数，独立可测）。
 *
 * - `extractPathFromArgv`：从启动参数提取首个绝对路径（`loom C:\path`）；
 * - `extractPathFromLoomUrl`：从 loom:// URL 提取路径（`loom://open?path=...`）。
 */
import fs from 'fs';

/** 从 argv 提取首个绝对路径参数（CLI：`loom C:\path`）。 */
export function extractPathFromArgv(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (!a || a === '.' || a.startsWith('-') || a.startsWith('--')) continue;
    if (/^[A-Za-z]:[\\/]/.test(a) || a.startsWith('\\\\')) {
      try { if (fs.existsSync(a)) return a; } catch { /* ignore */ }
    }
  }
  return null;
}

/** 从 loom:// URL 提取路径（loom://open?path=C%3A%5Cfoo）。 */
export function extractPathFromLoomUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'loom:') return null;
    const p = u.searchParams.get('path');
    if (p) return decodeURIComponent(p);
    return null;
  } catch {
    return null;
  }
}
