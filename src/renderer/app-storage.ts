import { inferWorkspaceFromOpenFiles } from './workspace-state';
import type { OpenFile } from './App';

export const extMap: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', json: 'json', md: 'markdown',
  css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', sh: 'shell',
  cpp: 'cpp', c: 'c', java: 'java', rb: 'ruby', php: 'php',
  xml: 'xml', svg: 'xml', sql: 'sql', dockerfile: 'dockerfile',
  toml: 'ini', ini: 'ini', env: 'properties', log: 'plaintext',
  txt: 'plaintext', csv: 'plaintext', bat: 'shell', ps1: 'shell',
  vue: 'html', svelte: 'html',
};

export function detectLang(filename: string): string {
  const name = filename.toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return extMap[ext] || 'plaintext';
}

const LAYOUT_STORAGE = 'loom-layout-v1';
const PANEL_STATE_STORAGE = 'loom-panel-state-v1';
const SESSION_STORAGE = 'loom-session-v1';

export interface SavedLayout { sidebarWidth: number; panelHeight: number; activeView: string; aiPanelWidth: number; splitMode?: boolean; splitRatio?: number; splitIdx?: number; }

export function loadLayout(): SavedLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUT_STORAGE) || 'null');
    return { sidebarWidth: 260, panelHeight: 240, activeView: 'explorer', aiPanelWidth: 420, splitMode: false, splitRatio: 50, splitIdx: 0, ...(parsed || {}) };
  } catch {
    return { sidebarWidth: 260, panelHeight: 240, activeView: 'explorer', aiPanelWidth: 420, splitMode: false, splitRatio: 50, splitIdx: 0 };
  }
}
export function saveLayout(layout: SavedLayout) {
  try { localStorage.setItem(LAYOUT_STORAGE, JSON.stringify(layout)); } catch {}
}

export function loadPanelState(): { visible: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PANEL_STATE_STORAGE) || 'null') || { visible: false };
  } catch {
    return { visible: false };
  }
}
export function savePanelState(s: { visible: boolean }) {
  try { localStorage.setItem(PANEL_STATE_STORAGE, JSON.stringify(s)); } catch {}
}

/** 同步读 localStorage 会话（启动首帧降级用；正常路径走异步磁盘版）。 */
function loadSessionSync(): { openFiles: OpenFile[]; activeIdx: number; workspace: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.openFiles)) return null;
    return {
      ...parsed,
      workspace: parsed.workspace || inferWorkspaceFromOpenFiles(parsed.openFiles),
    };
  } catch {
    return null;
  }
}

/**
 * 异步加载会话：优先主进程磁盘（session:load，无配额限制、大文件完整），
 * IPC 不可用时回退 localStorage。
 */
export async function loadSession(): Promise<{ openFiles: OpenFile[]; activeIdx: number; workspace: string } | null> {
  try {
    const res = await window.loom?.session?.load?.() as { ok?: boolean; data?: any } | undefined;
    if (res?.ok && res.data && Array.isArray(res.data.openFiles)) {
      return {
        ...res.data,
        workspace: res.data.workspace || inferWorkspaceFromOpenFiles(res.data.openFiles),
      };
    }
  } catch { /* fall through */ }
  return loadSessionSync();
}

/**
 * 异步保存会话：优先主进程磁盘（原子写），失败回退 localStorage。
 * 截断护栏保留（contentTruncated 标记，防止恢复后误存截断内容覆盖磁盘）。
 */
export async function saveSession(s: { openFiles: OpenFile[]; activeIdx: number; workspace: string }): Promise<void> {
  // Trim large content to keep storage small
  const compact = {
    ...s,
    openFiles: s.openFiles.map(f => {
      // 用同一个截断函数处理 content 与 originalContent，保证二者始终一致，
      // 避免会话恢复后 >50000 字符的文件被误判为「已修改」（显示脏点圆圈）。
      const truncated = f.content.length > 50000 || f.originalContent.length > 50000;
      return {
        ...f,
        content: truncated ? f.content.substring(0, 50000) + '\n/* ...truncated for session restore... */' : f.content,
        originalContent: truncated ? f.originalContent.substring(0, 50000) + '\n/* ...truncated for session restore... */' : f.originalContent,
        // DATA-SAFETY: mark files whose content was truncated so the app can
        // refuse to save them back over the real on-disk file (see App.tsx
        // saveFile / saveAllFiles). Without this, one Ctrl+S after a session
        // restore would permanently overwrite the file with truncated text.
        contentTruncated: truncated || undefined,
      };
    }),
  };
  try {
    const res = await window.loom?.session?.save?.(compact) as { ok?: boolean } | undefined;
    if (res?.ok) return;
  } catch { /* fall through to localStorage */ }
  try { localStorage.setItem(SESSION_STORAGE, JSON.stringify(compact)); } catch { /* quota exceeded — ignore */ }
}
