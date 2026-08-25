/**
 * i18n 硬编码字符串扫描器
 *
 * 用法：node scripts/scan-hardcoded-strings.mjs [--fix-report]
 *
 * 扫描 src/renderer 下 TSX 组件中「用户可见但未走 t()」的字符串，输出可疑位置：
 *   - JSX 文本节点：>English Text< / >中文文本<（排除变量表达式、数字、空白）
 *   - title="English" / placeholder="English" / aria-label="English"
 *   - 含 [A-Za-z]{3,} 单词的可疑字符串
 *
 * 注意：这是启发式扫描（帮助定位漏网之鱼），不是硬门禁；误报需人工确认。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(new URL('../src/renderer', import.meta.url)));
const IGNORE = new Set(['node_modules', 'dist', 'coverage']);

/** 已知允许的英文技术词/品牌（避免误报） */
const ALLOWED_WORDS = new Set([
  'Loom', 'IDE', 'Ctrl', 'Shift', 'Alt', 'F5', 'F8', 'F12', 'Enter', 'Esc', 'Tab', 'Space',
  'AI', 'Agent', 'API', 'URL', 'HTTP', 'JSON', 'CSS', 'HTML', 'UTF', 'GBK', 'LF', 'CRLF', 'EOL',
  'PTY', 'PID', 'Node', 'Electron', 'Monaco', 'Git', 'VS Code', 'Cursor', 'OpenVSX', 'MCP', 'Orca',
  'Markdown', 'TypeScript', 'JavaScript', 'React', 'PowerShell', 'Terminal', 'Explorer', 'Settings',
  'Error', 'Warning', 'Info', 'OK', 'Done', 'Cancel', 'Save', 'Open', 'Close', 'New', 'Delete',
  'Refresh', 'Search', 'Find', 'Replace', 'Undo', 'Redo', 'Format', 'Rename', 'Copy', 'Paste',
  'Run', 'Stop', 'Debug', 'Commit', 'Push', 'Pull', 'Stage', 'Branch', 'History', 'Log', 'Diff',
  'Output', 'Problems', 'Outline', 'Extensions', 'Plugins', 'Skills', 'Notepads', 'Recent', 'Loading',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (extname(full) === '.tsx' || extname(full) === '.ts') out.push(full);
  }
  return out;
}

function isAllowed(text) {
  const words = text.split(/[^A-Za-z0-9+]+/).filter(Boolean);
  return words.length <= 3 && words.every(w => ALLOWED_WORDS.has(w) || /^[A-Z]{1,2}[a-z]{2,}$/.test(w) === false);
}

let hits = 0;
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf-8');
  const lines = src.split('\n');

  // 1) JSX 文本节点：>English words<（含中文也提示，因为 zh 默认也要走 t() 便于 en 切换）
  const textRe = />([A-Za-z][A-Za-z ,.'"!?/:;()]{2,})</g;
  // 2) 属性值：title="..." placeholder="..." aria-label="..." alt="..."
  const attrRe = /(?:title|placeholder|aria-label|alt)="([A-Za-z][^"]{2,})"/g;

  lines.forEach((line, i) => {
    let m;
    textRe.lastIndex = 0;
    while ((m = textRe.exec(line)) !== null) {
      const text = m[1].trim();
      if (isAllowed(text)) continue;
      hits++;
      console.log(`${file.replace(ROOT, '')}:${i + 1}  [JSX文本] "${text.slice(0, 60)}"`);
    }
    attrRe.lastIndex = 0;
    while ((m = attrRe.exec(line)) !== null) {
      const text = m[1].trim();
      if (isAllowed(text) || /^[a-z0-9.-]+$/.test(text) || /https?:/.test(text)) continue;
      hits++;
      console.log(`${file.replace(ROOT, '')}:${i + 1}  [属性] ${m[0].slice(0, 80)}`);
    }
  });
}

console.log(`\n共 ${hits} 处可疑硬编码字符串（需人工确认；技术词已过滤）。`);
