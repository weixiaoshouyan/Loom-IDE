import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleBar from './components/TitleBar';
import ActivityBar from './components/ActivityBar';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Panel from './components/Panel';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import ConfirmModal from './components/ConfirmModal';
import { confirmDialog } from './components/ConfirmModal';
import AIAgent from './components/AIAgent';
import Settings from './components/Settings';
import NotificationContainer, { NotificationItem, NotificationType } from './components/Notification';
import EditorGroup from './components/EditorGroup';
import TabBar from './components/TabBar';
import Breadcrumb from './components/Breadcrumb';
import ErrorBoundary from './components/ErrorBoundary';
import LocalHistory from './components/LocalHistory';
import { closeWorkspaceState, fsReadErrorMessage, inferWorkspaceFromOpenFiles, isFileDirty, isFsReadError, upsertOpenFile } from './workspace-state';
import { clampAssistantPanelWidth } from './assistant-panel';
import { detectLang, loadLayout, saveLayout, loadPanelState, savePanelState, loadSession, saveSession, extMap, type SavedLayout } from './app-storage';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  originalContent: string;
  /**
   * Set when the session restore truncated this file's content to fit in
   * localStorage. Saving truncated content would permanently destroy the
   * on-disk file, so saveFile/saveAllFiles refuse to write while this is set.
   */
  contentTruncated?: boolean;
}

export default function App() {
  const layout = loadLayout();
  const panelState = loadPanelState();
  const session = loadSession();

  const [openFiles, setOpenFiles] = useState<OpenFile[]>(session?.openFiles || []);
  const [activeIdx, setActiveIdx] = useState(Math.min(session?.activeIdx || 0, Math.max(0, (session?.openFiles?.length || 1) - 1)));
  const [workspace, setWorkspace] = useState(session?.workspace || '');
  const [sidebarView, setSidebarView] = useState<string>(session?.workspace ? 'explorer' : layout.activeView);
  const [sidebarWidth, setSidebarWidth] = useState(layout.sidebarWidth);
  const [panelVisible, setPanelVisible] = useState(panelState.visible);
  const [panelHeight, setPanelHeight] = useState(layout.panelHeight);
  const [cmdPalette, setCmdPalette] = useState(false);
  const [untitledCount, setUntitledCount] = useState(
    Math.max(1, (session?.openFiles || []).filter(f => f.path.startsWith('untitled-')).length + 1)
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [problems, setProblems] = useState<{ severity: string; message: string; file?: string; line?: number }[]>([]);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [agentStatus, setAgentStatus] = useState<'online' | 'offline'>('offline');
  const [aiMode, setAiMode] = useState<'orca' | 'builtin'>('builtin');
  const [orcaOnline, setOrcaOnline] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [workspaceRules, setWorkspaceRules] = useState<string>('');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const notifIdRef = useRef(0);
  const [splitMode, setSplitMode] = useState(layout.splitMode ?? false);
  const [splitRatio, setSplitRatio] = useState(layout.splitRatio ?? 50);
  const [splitIdx, setSplitIdx] = useState(layout.splitIdx ?? 0);
  const [focusSide, setFocusSide] = useState<'left' | 'right'>('left');
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, string>>({});
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState(clampAssistantPanelWidth(layout.aiPanelWidth));

  const debugCleanupRef = useRef<(() => void) | null>(null);
  const minimapRef = useRef(true);
  // Stale-tracking: file path -> { onDisk: string; dirty: boolean }
  const staleFilesRef = useRef<Set<string>>(new Set());
  // 保存防 race 标记：path -> 时间戳。watcher 触发时若 1.5s 内该路径刚被
  // 保存过，则跳过 stale 标记（避免用户自己保存的文件被误判为「外部修改」）。
  const recentlySavedRef = useRef<Map<string, number>>(new Map());
  // Debounce snapshot writes for local history
  const snapshotTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 会话持久化防抖：避免每次按键都序列化全部打开文件到 localStorage
  const saveSessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs for callbacks that need current values (avoid stale closures)
  const openFilesRef = useRef(openFiles);
  const activeIdxRef = useRef(activeIdx);
  useEffect(() => { openFilesRef.current = openFiles; }, [openFiles]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  // ==== Apply theme + locale ====
  const applyTheme = useCallback((t: 'dark' | 'light' | 'system') => {
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  // Keep the i18n framework locale in sync with the app's React state locale.
  const syncI18nLocale = useCallback((loc: string) => {
    const { setLocale: setI18nLocale } = require('@/shared/i18n');
    setI18nLocale(loc === 'zh-CN' ? 'zh-CN' : 'en');
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.loom?.settings?.getAll?.().then((s: any) => {
      if (cancelled || !s) return;
      const t = s.theme || 'dark';
      applyTheme(t);
      if (s.locale) {
        setLocale(s.locale);
        syncI18nLocale(s.locale);
      }
    }).catch(() => {});

    // Listen for system theme changes when in "system" mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const current = document.documentElement.getAttribute('data-theme');
      if (current === 'system') {
        // Force a re-render so the @media query takes effect
        document.documentElement.style.colorScheme = mq.matches ? 'dark' : 'light';
      }
    };
    mq.addEventListener?.('change', onSystemChange);
    document.documentElement.style.colorScheme = mq.matches ? 'dark' : 'light';

    const handler = (e: CustomEvent) => {
      if (e.detail?.key === 'theme') applyTheme(e.detail.value);
      if (e.detail?.key === 'locale') {
        setLocale(e.detail.value);
        syncI18nLocale(e.detail.value);
      }
    };
    window.addEventListener('loom:setting-change' as any, handler);
    return () => {
      cancelled = true;
      mq.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('loom:setting-change' as any, handler);
    };
  }, [applyTheme, syncI18nLocale]);

  // ==== Check agent status (both modes) ====
  useEffect(() => {
    const check = () => {
      window.loom.ai.getConfig().then((c: any) => {
        setAiMode('builtin');
        setOrcaOnline(false);
        const provider = c?.providers?.find((p: any) => p.id === c.activeProviderId);
        setAgentStatus(provider?.apiKey ? 'online' : 'offline');
      }).catch(() => setAgentStatus('offline'));
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  // ==== Git status（watcher 触发为主，低频轮询为补充）====
  useEffect(() => {
    if (!workspace) { setGitStatusMap({}); setGitBranch(null); return; }
    let timer: ReturnType<typeof setInterval> | null = null;
    const fetchStatus = () => {
      window.loom?.git?.status?.(workspace).then((result: any) => {
        const map: Record<string, string> = {};
        (result?.changes || []).forEach((c: any) => { if (c.file) map[c.file] = c.status; });
        setGitStatusMap(map);
        setGitBranch(result?.branch || null);
      }).catch(() => { setGitStatusMap({}); setGitBranch(null); });
    };
    fetchStatus();
    // Low-frequency fallback poll (30s) — the file watcher handles real-time updates.
    const startPolling = () => { if (!timer && document.hasFocus()) timer = setInterval(fetchStatus, 30000); };
    const stopPolling = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (document.hasFocus()) startPolling();
    const onFocus = () => { fetchStatus(); startPolling(); };
    const onBlur = () => stopPolling();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      stopPolling();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [workspace]);

  // ==== File watcher ====
  useEffect(() => {
    if (!workspace) return;
    window.loom?.watcher?.start?.(workspace).catch(() => {});
    const cleanup = window.loom?.watcher?.onChange?.((_cwd: string, changedPaths: string[]) => {
      window.loom?.git?.status?.(workspace).then((result: any) => {
        const map: Record<string, string> = {};
        (result?.changes || []).forEach((c: any) => { if (c.file) map[c.file] = c.status; });
        setGitStatusMap(map);
        setGitBranch(result?.branch || null);
      }).catch(() => {});
      // Mark open files as stale so the user can choose to reload.
      // This only fires for files that are *not* currently dirty, because if
      // the user has unsaved changes, the disk version is theirs to overwrite.
      setOpenFiles(prev => {
        const stale = staleFilesRef.current;
        let mutated = false;
        const now = Date.now();
        const recentlySaved = recentlySavedRef.current;
        const next = prev.map(f => {
          if (changedPaths.some(p => f.path === p || p.endsWith(f.path) || f.path.endsWith(p))) {
            // Race 防护：保存动作刚把 originalContent := content，watcher 紧接着
            // 触发同一文件 → 满足 f.content === f.originalContent 但其实是
            // 用户自己保存触发的，不应被误标为「外部修改」。
            // 1.5s 内保存过的路径直接跳过 stale 标记。
            const savedAt = recentlySaved.get(f.path);
            if (savedAt && now - savedAt < 1500) return f;
            if (f.content === f.originalContent) {
              stale.add(f.path);
              mutated = true;
            }
          }
          return f;
        });
        if (mutated) {
          // 仅在磁盘变更真正影响打开文件时定向刷新，移除全局 2s 定时器
          queueMicrotask(() => setStaleVersion(v => v + 1));
          return [...next];
        }
        return prev;
      });
    });
    return () => {
      window.loom?.watcher?.stop?.().catch(() => {});
      if (cleanup) cleanup();
    };
  }, [workspace]);

  // Re-read a file from disk and refresh the open file's content (Revert).
  const revertFile = useCallback(async (filePath: string) => {
    try {
      const fresh = await window.loom.fs.readFile(filePath);
      setOpenFiles(prev => prev.map(f => f.path === filePath
        ? { ...f, content: fresh, originalContent: fresh }
        : f));
      staleFilesRef.current.delete(filePath);
      setStaleVersion(v => v + 1);
      window.dispatchEvent(new CustomEvent('loom:notify', {
        detail: { message: `已从磁盘重新加载: ${filePath.split(/[\\/]/).pop()}`, type: 'info' },
      }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', {
        detail: { message: `重新加载失败: ${e.message}`, type: 'error' },
      }));
    }
  }, []);

  // Expose revert to menu / command palette via a custom event.
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const f = openFiles[activeIdx];
      if (f && f.path) revertFile(f.path);
    };
    window.addEventListener('loom:revert-file' as any, handler);
    return () => window.removeEventListener('loom:revert-file' as any, handler);
  }, [openFiles, activeIdx, revertFile]);

  // ==== Local history snapshots (file-level, 30s debounce) ====
  useEffect(() => {
    // Whenever an open file's content changes materially, schedule a snapshot.
    openFiles.forEach(f => {
      if (!f.path || f.path.startsWith('untitled-')) return;
      if (f.content === f.originalContent) return;
      if (snapshotTimerRef.current[f.path]) return; // already scheduled
      const timer = setTimeout(() => {
        delete snapshotTimerRef.current[f.path];
        // Use a dedicated IPC; we fall back to no-op if backend not available
        window.loom?.history?.snapshot?.(f.path, f.content, f.originalContent)
          ?.catch?.(() => {});
      }, 30000);
      snapshotTimerRef.current[f.path] = timer;
    });
    // Cleanup timers for files that closed
    Object.keys(snapshotTimerRef.current).forEach(p => {
      if (!openFiles.find(f => f.path === p)) {
        clearTimeout(snapshotTimerRef.current[p]);
        delete snapshotTimerRef.current[p];
      }
    });
  }, [openFiles]);

  // ==== Persist layout & session ====
  useEffect(() => {
    saveLayout({ sidebarWidth, panelHeight, activeView: sidebarView, aiPanelWidth, splitMode, splitRatio, splitIdx });
  }, [sidebarWidth, panelHeight, sidebarView, aiPanelWidth, splitMode, splitRatio, splitIdx]);

  useEffect(() => {
    savePanelState({ visible: panelVisible });
  }, [panelVisible]);

  useEffect(() => {
    if (saveSessionTimer.current) clearTimeout(saveSessionTimer.current);
    saveSessionTimer.current = setTimeout(() => {
      saveSession({ openFiles, activeIdx, workspace });
    }, 1500);
    return () => { if (saveSessionTimer.current) clearTimeout(saveSessionTimer.current); };
  }, [openFiles, activeIdx, workspace]);

  // ==== Notifications ====
  const addNotification = useCallback((message: string, type: NotificationType = 'info', duration?: number) => {
    const id = 'n' + (++notifIdRef.current);
    setNotifications(prev => [...prev, { id, type, message, duration }]);
  }, []);
  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { message, type, duration } = e.detail || {};
      if (message) addNotification(message, type || 'info', duration);
    };
    window.addEventListener('loom:notify' as any, handler);
    return () => window.removeEventListener('loom:notify' as any, handler);
  }, [addNotification]);

  useEffect(() => {
    const handler = () => setOutputLines([]);
    window.addEventListener('loom:clear-output' as any, handler);
    return () => window.removeEventListener('loom:clear-output' as any, handler);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => setProblems(e.detail || []);
    window.addEventListener('loom:diagnostics' as any, handler);
    return () => window.removeEventListener('loom:diagnostics' as any, handler);
  }, []);

  // ==== Workspace rules ====
  useEffect(() => {
    if (!workspace) { setWorkspaceRules(''); return; }
    const loadRules = async () => {
      try {
        const rulesPath = workspace.replace(/[\\/]/g, '/').replace(/\/$/, '') + '/.loomrules';
        const content = await window.loom.fs.readFile(rulesPath);
        if (typeof content === 'string' && !content.startsWith('__ERR__:')) {
          setWorkspaceRules(content);
        } else {
          setWorkspaceRules('');
        }
      } catch { setWorkspaceRules(''); }
    };
    loadRules();
  }, [workspace]);

  // 打开工作区后空闲预建代码索引，避免首次 @检索/智能问答阻塞（P1-2）
  useEffect(() => {
    if (!workspace) return;
    const t = setTimeout(() => {
      window.loom?.codeIndex?.prebuild?.(workspace).catch?.(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [workspace]);
  useEffect(() => {
    const f = openFiles[activeIdx];
    if (!f) { document.title = 'Loom IDE'; return; }
    const dirty = isFileDirty(f.content, f.originalContent);
    document.title = (dirty ? '● ' : '') + f.name + ' - Loom IDE';
  }, [openFiles, activeIdx]);

  // ==== File operations ====
  const openFileFromDisk = useCallback(async () => {
    const files = await window.loom.dialog.openFile();
    if (!files) return;
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return;

    setOpenFiles(prev => {
      const currentOpen = prev;
      const toAdd: OpenFile[] = [];
      let focused = -1;
      for (const f of fileList) {
        const existing = currentOpen.findIndex(of => of.path === f.path);
        if (existing >= 0) { focused = existing; continue; }
        toAdd.push({
          path: f.path,
          name: f.path.split(/[\\/]/).pop() || 'untitled',
          content: f.content,
          language: detectLang(f.path),
          originalContent: f.content,
        });
      }
      if (toAdd.length > 0) {
        const merged = [...currentOpen, ...toAdd];
        const newIdx = merged.length - 1;
        queueMicrotask(() => {
          setActiveIdx(newIdx);
          setSelectedFile(toAdd[toAdd.length - 1].path);
        });
        return merged;
      } else if (focused >= 0) {
        queueMicrotask(() => {
          setActiveIdx(focused);
          setSelectedFile(currentOpen[focused]?.path || '');
        });
        return currentOpen;
      }
      return currentOpen;
    });
  }, []);

  const openFolder = useCallback(async () => {
    const folder = await window.loom.dialog.openFolder();
    if (folder) {
      setWorkspace(folder);
    }
  }, []);

  const openFolderByPath = useCallback(async (folder: string) => {
    // Directly open a known folder path (used by recent folders)
    // Main process validates the path and grants permissions before we use it.
    try {
      const result = await window.loom.dialog.openFolderByPath(folder);
      if (result.ok && result.folder) {
        setWorkspace(result.folder);
        addNotification(`已打开: ${result.folder.split(/[\\/]/).pop()}`, 'info', 2500);
      } else {
        addNotification(`无法打开文件夹: ${result.message || folder}`, 'error', 4000);
      }
    } catch {
      addNotification(`无法打开文件夹: ${folder}`, 'error', 4000);
    }
  }, [addNotification]);

  const addOrFocusFile = useCallback((filePath: string, content: string) => {
    if (isFsReadError(content)) {
      addNotification(`无法打开文件: ${fsReadErrorMessage(content)}`, 'error', 6000);
      return;
    }
    setOpenFiles(prev => {
      const nextState = upsertOpenFile(prev, activeIdx, filePath, content, detectLang(filePath));
      queueMicrotask(() => {
        setActiveIdx(nextState.activeIdx);
        setSelectedFile(nextState.selectedFile);
      });
      return nextState.openFiles;
    });
  }, [activeIdx, addNotification]);

  const closeWorkspace = useCallback(async () => {
    const dirty = openFiles.filter(f => isFileDirty(f.content, f.originalContent));
    if (dirty.length > 0) {
      const ok = await confirmDialog.ask({
        title: '关闭文件夹',
        message: `${dirty.length} 个文件有未保存的修改。确定关闭？`,
        confirmText: '关闭',
        danger: true,
      });
      if (!ok) return;
    }
    const next = closeWorkspaceState(openFiles);
    setWorkspace(next.workspace);
    setOpenFiles(next.openFiles);
    setActiveIdx(next.activeIdx);
    setSelectedFile(next.selectedFile);
    setSplitMode(false);
    setAiOpen(false);
    setSidebarView('explorer');
    addNotification('已关闭当前文件夹', 'info', 2500);
  }, [openFiles, addNotification]);

  const createUntitledFile = useCallback(() => {
    const name = 'untitled-' + untitledCount;
    setUntitledCount(c => c + 1);
    addOrFocusFile(name, '');
  }, [untitledCount, addOrFocusFile]);

  const handleContentChange = useCallback((filePath: string, newContent: string) => {
    setOpenFiles(prev => prev.map(f => f.path === filePath ? { ...f, content: newContent } : f));
  }, []);

  const saveFile = useCallback(async () => {
    // Read current values from refs to avoid stale closures
    const currentFiles = openFilesRef.current;
    const currentIdx = activeIdxRef.current;
    const f = currentFiles[currentIdx];
    if (!f) return;
    if (!f.path || f.path.startsWith('untitled-')) {
      // Save As for new files
      try {
        const result = await window.loom.dialog.saveFile(f.name) as { canceled?: boolean; filePath?: string } | null;
        if (!result || result.canceled || !result.filePath) return;
        const newPath = result.filePath;
        const newName = newPath.split(/[/\\]/).pop() || newPath;
        await window.loom.fs.writeFile(newPath, f.content);
        setOpenFiles(prev => prev.map(x => x === f
          ? { ...x, path: newPath, name: newName, originalContent: f.content }
          : x));
        setSelectedFile(newPath);
        addNotification(`已保存: ${newName}`, 'success');
      } catch (e: any) {
        addNotification(`另存为失败: ${e.message}`, 'error');
      }
      return;
    }
    try {
      // DATA-SAFETY: never write session-truncated content back over the real
      // on-disk file — that would permanently destroy the original text.
      if (f.contentTruncated) {
        addNotification(`「${f.name}」的内容因会话恢复被截断，已阻止保存（防止覆盖磁盘原文件）。请关闭后重新打开该文件再保存。`, 'error');
        return;
      }
      await window.loom.fs.writeFile(f.path, f.content);
      setOpenFiles(prev => prev.map(x => x === f ? { ...x, originalContent: f.content } : x));
      staleFilesRef.current.delete(f.path);
      // 记录保存时间戳，让 watcher 在 1.5s 内忽略该路径的 stale 标记
      recentlySavedRef.current.set(f.path, Date.now());
      setStaleVersion(v => v + 1);
      addNotification(`已保存: ${f.name}`, 'success');
    } catch (e: any) {
      addNotification(`保存失败 ${f.name}: ${e.message}`, 'error');
    }
  }, [addNotification]);

  const saveAllFiles = useCallback(async () => {
    // Read current values from refs
    const currentFiles = openFilesRef.current;
    const filesToSave = currentFiles.filter(f => isFileDirty(f.content, f.originalContent));
    if (filesToSave.length === 0) {
      addNotification('没有需要保存的文件', 'info');
      return;
    }
    const failed: string[] = [];
    const saved: string[] = [];
    for (const f of filesToSave) {
      try {
        if (f.contentTruncated) {
          // DATA-SAFETY: same guard as saveFile — truncated session content
          // must never overwrite the real file on disk.
          failed.push(`${f.name}（会话截断，已阻止保存）`);
          continue;
        }
        if (!f.path || f.path.startsWith('untitled-')) {
          const result = await window.loom.dialog.saveFile(f.name) as { canceled?: boolean; filePath?: string } | null;
          if (!result || result.canceled || !result.filePath) continue;
          await window.loom.fs.writeFile(result.filePath, f.content);
          const newPath = result.filePath;
          const newName = newPath.split(/[/\\]/).pop() || newPath;
          setOpenFiles(prev => prev.map(x => x === f
            ? { ...x, path: newPath, name: newName, originalContent: f.content }
            : x));
          saved.push(newPath);
        } else {
          await window.loom.fs.writeFile(f.path, f.content);
          saved.push(f.path);
        }
      } catch (e: any) {
        failed.push(f.path || f.name);
      }
    }
    // Single update pass: mark successfully-saved files as not-dirty
    if (saved.length > 0) {
      setOpenFiles(prev => prev.map(f => saved.includes(f.path) ? { ...f, originalContent: f.content } : f));
      // 记录保存时间戳，让 watcher 在 1.5s 内忽略这些路径的 stale 标记
      const now = Date.now();
      saved.forEach(p => recentlySavedRef.current.set(p, now));
    }
    if (failed.length > 0) {
      addNotification(`保存失败: ${failed.length} 个文件`, 'error');
    } else {
      addNotification(`已保存 ${saved.length} 个文件`, 'success');
    }
  }, [openFiles, addNotification]);

  const addOutput = (msg: string) => {
    setOutputLines(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // ==== Debugger ====
  const startDebug = useCallback(async () => {
    setPanelVisible(true);
    window.dispatchEvent(new CustomEvent('loom:open-panel-tab', { detail: 'output' }));
    const f = openFilesRef.current[activeIdxRef.current];
    if (!f) { addOutput('Debug: 请先打开一个文件。'); return; }
    if (!workspace) { addOutput('Debug: 请先打开一个文件夹。'); return; }
    if (isDebugging) { addOutput('Debug: 已有调试会话在进行中。'); return; }

    addOutput(`Debug: 启动调试 ${f.path}...`);
    try {
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
        debugCleanupRef.current = null;
      }
      const result = await window.loom.debug?.start?.(f.path, workspace);
      if (result?.ok) {
        addOutput('Debug: ' + (result.message || '已启动 (port 9229)'));
        setIsDebugging(true);
        const cleanupFns: (() => void)[] = [];
        const removeStdout = window.loom.debug?.onStdout?.((data: string) => addOutput('[stdout] ' + data.trim()));
        const removeStderr = window.loom.debug?.onStderr?.((data: string) => addOutput('[stderr] ' + data.trim()));
        const removeExit = window.loom.debug?.onExit?.((code: number | null) => {
          addOutput(`Debug: 进程退出 (code=${code})`);
          setIsDebugging(false);
        });
        if (removeStdout) cleanupFns.push(removeStdout);
        if (removeStderr) cleanupFns.push(removeStderr);
        if (removeExit) cleanupFns.push(removeExit);
        debugCleanupRef.current = () => cleanupFns.forEach(fn => fn());
      } else {
        addOutput('Debug: 启动失败 - ' + (result?.message || '未知错误'));
      }
    } catch (e: any) {
      addOutput('Debug 错误: ' + e.message);
    }
  }, [workspace, isDebugging]);

  const runCurrentFile = useCallback(async () => {
    setPanelVisible(true);
    window.dispatchEvent(new CustomEvent('loom:open-panel-tab', { detail: 'output' }));
    const f = openFilesRef.current[activeIdxRef.current];
    if (!f) { addOutput('Run: 请先打开一个文件。'); return; }
    if (!workspace) { addOutput('Run: 请先打开一个文件夹。'); return; }
    if (isRunning) { addOutput('Run: 已有运行任务在进行中。'); return; }

    setIsRunning(true);
    addOutput(`Run: 启动 ${f.path.split(/[\\/]/).pop()}...`);
    try {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      let cmd = '';
      if (ext === 'ts' || ext === 'tsx') cmd = `npx tsx "${f.path}"`;
      else if (ext === 'js' || ext === 'mjs') cmd = `node "${f.path}"`;
      else if (ext === 'py') cmd = `python "${f.path}"`;
      else if (ext === 'go') cmd = `go run "${f.path}"`;
      else if (ext === 'rs') cmd = `cargo run`;
      else if (ext === 'sh') cmd = `bash "${f.path}"`;
      else if (ext === 'ps1') cmd = `powershell -File "${f.path}"`;
      else { addOutput(`Run: 不支持的文件类型: .${ext}`); setIsRunning(false); return; }

      const output = await window.loom.cliAgents?.run?.('run', cmd, workspace);
      // Fallback: use shell execution
      addOutput(output || `Run: 已启动 ${f.path.split(/[\\/]/).pop()}`);
    } catch (e: any) {
      addOutput(`Run 错误: ${e.message}`);
    }
    setIsRunning(false);
  }, [workspace, isRunning, addOutput]);

  const stopDebug = useCallback(async () => {
    if (!isDebugging) { addOutput('Debug: 没有正在进行的调试会话。'); return; }
    addOutput('Debug: 停止中...');
    try {
      await window.loom.debug?.stop?.();
      addOutput('Debug: 已停止');
      setIsDebugging(false);
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
        debugCleanupRef.current = null;
      }
    } catch (e: any) {
      addOutput('Debug 停止错误: ' + e.message);
    }
  }, [isDebugging]);

  useEffect(() => {
    return () => {
      if (debugCleanupRef.current) debugCleanupRef.current();
    };
  }, []);

  const closeTab = useCallback(async (idx: number) => {
    // Snapshot first to avoid stale captures
    const target = openFiles[idx];
    if (target && isFileDirty(target.content, target.originalContent)) {
      const ok = await confirmDialog.ask({
        title: '关闭标签页',
        message: `"${target.name}" 有未保存的修改。是否关闭？`,
        confirmText: '关闭',
        danger: true,
      });
      if (!ok) return;
    }
    setOpenFiles(prev => {
      const nf = prev.filter((_, i) => i !== idx);
      if (nf.length === 0) {
        queueMicrotask(() => { setActiveIdx(0); setSelectedFile(''); });
      } else if (activeIdx >= nf.length) {
        queueMicrotask(() => { setActiveIdx(nf.length - 1); setSelectedFile(nf[nf.length - 1]?.path || ''); });
      } else if (activeIdx > idx) {
        queueMicrotask(() => setActiveIdx(activeIdx - 1));
      } else {
        queueMicrotask(() => setSelectedFile(nf[activeIdx]?.path || ''));
      }
      return nf;
    });
  }, [openFiles, activeIdx]);

  const closeAllTabs = useCallback(async () => {
    const dirty = openFiles.filter(f => isFileDirty(f.content, f.originalContent));
    if (dirty.length > 0) {
      const ok = await confirmDialog.ask({
        title: '关闭所有标签页',
        message: `${dirty.length} 个文件有未保存的修改。确定关闭所有标签页？`,
        confirmText: '全部关闭',
        danger: true,
      });
      if (!ok) return;
    }
    setOpenFiles([]);
    setActiveIdx(0);
    setSelectedFile('');
  }, [openFiles]);

  const closeOtherTabs = useCallback(async (idx: number) => {
    const target = openFiles[idx];
    if (!target) return;
    const others = openFiles.filter((_, i) => i !== idx);
    const dirty = others.filter(f => isFileDirty(f.content, f.originalContent));
    if (dirty.length > 0) {
      const ok = await confirmDialog.ask({
        title: '关闭其他标签页',
        message: `${dirty.length} 个文件有未保存的修改。确定关闭其他标签页？`,
        confirmText: '关闭其他',
        danger: true,
      });
      if (!ok) return;
    }
    setOpenFiles([target]);
    setActiveIdx(0);
    setSelectedFile(target.path);
  }, [openFiles]);

  // ==== Keyboard shortcuts (extracted hook) ====
  useKeyboardShortcuts(
    {
      createUntitledFile,
      closeTab,
      openFileFromDisk,
      openFolder,
      startDebug,
      stopDebug,
      runCurrentFile,
      addOutput,
      setCmdPalette,
      setAiOpen,
      setSidebarView,
      setPanelVisible,
      setSplitMode,
      setSettingsOpen,
    },
    { openFilesCount: openFiles.length, activeIdx, isDebugging },
  );

  // ==== Welcome page command listener ====
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const cmd = e.detail;
      if (cmd === 'openFile') openFileFromDisk();
      else if (cmd === 'openFolder') openFolder();
      else if (cmd === 'newFile') createUntitledFile();
      else if (cmd === 'openSettings') setSettingsOpen(true);
      else if (cmd === 'closeFolder') closeWorkspace();
      else if (cmd === 'toggleAI') setAiOpen(p => !p);
    };
    window.addEventListener('loom:cmd' as any, handler);
    const folderHandler = (e: CustomEvent) => {
      if (typeof e.detail === 'string') openFolderByPath(e.detail);
    };
    window.addEventListener('loom:open-folder-path' as any, folderHandler);
    const saveHandler = (e: CustomEvent) => {
      if (e.detail?.all) saveAllFiles();
      else saveFile();
    };
    window.addEventListener('loom:save-file' as any, saveHandler);
    return () => {
      window.removeEventListener('loom:cmd' as any, handler);
      window.removeEventListener('loom:open-folder-path' as any, folderHandler);
      window.removeEventListener('loom:save-file' as any, saveHandler);
    };
  }, [openFileFromDisk, openFolder, createUntitledFile, closeWorkspace, openFolderByPath, saveFile, saveAllFiles]);

  // ==== Drag-and-drop files ====
  useEffect(() => {
    let dragCounter = 0;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        dragCounter++;
        setIsDraggingFile(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsDraggingFile(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setIsDraggingFile(false);
      const files = Array.from(e.dataTransfer?.files || []);
      for (const f of files) {
        // Electron exposes the file path via webUtils.getPathForFile OR the file.path property
        let filePath = (f as any).path;
        // Fallback to webUtils.getPathForFile (newer Electron)
        if (!filePath && (window as any).webUtils?.getPathForFile) {
          try { filePath = (window as any).webUtils.getPathForFile(f); } catch {}
        }
        if (!filePath) {
          // Last resort: read content via FileReader (works for browser-drop, no path)
          try {
            const text = await f.text();
            addOrFocusFile('untitled-dropped-' + f.name, text);
          } catch {}
          continue;
        }
        try {
          const content = await window.loom.fs.readFile(filePath);
          addOrFocusFile(filePath, content);
        } catch {}
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addOrFocusFile]);

  // ==== Menus ====
  const menuItems = React.useMemo(() => [
    {
      label: locale === 'zh-CN' ? '文件' : 'File',
      items: [
        { label: locale === 'zh-CN' ? '新建文件' : 'New File', shortcut: 'Ctrl+N', action: createUntitledFile },
        { label: locale === 'zh-CN' ? '打开文件...' : 'Open File...', shortcut: 'Ctrl+O', action: openFileFromDisk },
        { label: locale === 'zh-CN' ? '打开文件夹...' : 'Open Folder...', shortcut: 'Ctrl+Shift+O', action: openFolder },
        { label: locale === 'zh-CN' ? '关闭文件夹' : 'Close Folder', action: closeWorkspace, disabled: !workspace },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '保存' : 'Save', shortcut: 'Ctrl+S', action: saveFile },
        { label: locale === 'zh-CN' ? '保存全部' : 'Save All', shortcut: 'Ctrl+Shift+S', action: saveAllFiles },
        { label: locale === 'zh-CN' ? '重新载入文件' : 'Revert File', action: () => window.dispatchEvent(new CustomEvent('loom:revert-file')) },
        { label: locale === 'zh-CN' ? '查看历史...' : 'Local History...', action: () => { const f = openFiles[activeIdx]; if (f?.path) setHistoryTarget(f.path); } },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '关闭标签页' : 'Close Tab', shortcut: 'Ctrl+W', action: () => { if (openFiles.length) closeTab(activeIdx); } },
        { label: locale === 'zh-CN' ? '关闭其他' : 'Close Others', action: () => closeOtherTabs(activeIdx) },
        { label: locale === 'zh-CN' ? '关闭所有标签页' : 'Close All Tabs', action: closeAllTabs },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '首选项' : 'Preferences', shortcut: 'Ctrl+,', action: () => setSettingsOpen(true) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '退出' : 'Exit', action: () => window.loom?.window?.close?.() },
      ],
    },
    {
      label: locale === 'zh-CN' ? '编辑' : 'Edit',
      items: [
        { label: locale === 'zh-CN' ? '撤销' : 'Undo', shortcut: 'Ctrl+Z', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'undo' } })); } },
        { label: locale === 'zh-CN' ? '重做' : 'Redo', shortcut: 'Ctrl+Y', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'redo' } })); } },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '查找' : 'Find', shortcut: 'Ctrl+F', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'find' } })); } },
        { label: locale === 'zh-CN' ? '替换' : 'Replace', shortcut: 'Ctrl+H', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'replace' } })); } },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '在文件中查找' : 'Find in Files', shortcut: 'Ctrl+Shift+F', action: () => setSidebarView('search') },
      ],
    },
    {
      label: locale === 'zh-CN' ? '视图' : 'View',
      items: [
        { label: locale === 'zh-CN' ? '命令面板' : 'Command Palette', shortcut: 'Ctrl+Shift+P', action: () => setCmdPalette(true) },
        { label: locale === 'zh-CN' ? '快速打开文件' : 'Quick Open', shortcut: 'Ctrl+P', action: () => setCmdPalette(true) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '资源管理器' : 'Explorer', shortcut: 'Ctrl+Shift+E', action: () => setSidebarView('explorer') },
        { label: locale === 'zh-CN' ? '搜索' : 'Search', shortcut: 'Ctrl+Shift+F', action: () => setSidebarView('search') },
        { label: locale === 'zh-CN' ? '源码管理' : 'Source Control', shortcut: 'Ctrl+Shift+G', action: () => setSidebarView('git') },
        { label: locale === 'zh-CN' ? '扩展' : 'Extensions', shortcut: 'Ctrl+Shift+X', action: () => setSidebarView('extensions') },
        { label: locale === 'zh-CN' ? '代码大纲' : 'Outline', action: () => setSidebarView('outline') },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '集成终端' : 'Terminal', shortcut: 'Ctrl+`', action: () => setPanelVisible(p => !p) },
        { label: locale === 'zh-CN' ? '切换侧边栏' : 'Toggle Sidebar', shortcut: 'Ctrl+B', action: () => setSidebarView(v => v ? '' : 'explorer') },
        { label: locale === 'zh-CN' ? '分屏编辑' : 'Split Editor', shortcut: 'Ctrl+\\', action: () => setSplitMode(p => !p) },
        { separator: true, label: '' },
        { label: locale === 'zh-CN' ? '切换主题' : 'Toggle Theme', action: () => { const next = theme === 'dark' ? 'light' : 'dark'; applyTheme(next); window.loom?.settings?.set?.('theme', next); } },
      ],
    },
    {
      label: locale === 'zh-CN' ? '运行' : 'Run',
      items: [
        { label: locale === 'zh-CN' ? '启动调试' : 'Start Debugging', shortcut: 'F5', action: startDebug },
        { label: locale === 'zh-CN' ? '运行（不调试）' : 'Run Without Debugging', shortcut: 'Ctrl+F5', action: runCurrentFile },
        { label: locale === 'zh-CN' ? '停止调试' : 'Stop Debugging', shortcut: 'Shift+F5', action: stopDebug },
      ],
    },
    {
      label: locale === 'zh-CN' ? '帮助' : 'Help',
      items: [
        { label: locale === 'zh-CN' ? '关于 Loom IDE' : 'About Loom IDE', action: () => addNotification('Loom IDE v0.2.0 — AI 原生开发环境', 'info', 6000) },
        { label: locale === 'zh-CN' ? '快捷键' : 'Keyboard Shortcuts', action: () => setSettingsOpen(true) },
      ],
    },
  ], [locale, openFiles, activeIdx, theme, workspace, createUntitledFile, openFileFromDisk, openFolder, closeWorkspace, saveFile, saveAllFiles, closeTab, closeOtherTabs, closeAllTabs, startDebug, stopDebug, applyTheme, addNotification]);

  const commands = React.useMemo(() => [
    { id: 'file.open', label: locale === 'zh-CN' ? '文件: 打开文件' : 'File: Open File', shortcut: 'Ctrl+O', action: openFileFromDisk },
    { id: 'folder.open', label: locale === 'zh-CN' ? '文件: 打开文件夹' : 'File: Open Folder', shortcut: 'Ctrl+Shift+O', action: openFolder },
    { id: 'folder.close', label: locale === 'zh-CN' ? '文件: 关闭文件夹' : 'File: Close Folder', action: closeWorkspace },
    { id: 'file.new', label: locale === 'zh-CN' ? '文件: 新建' : 'File: New', shortcut: 'Ctrl+N', action: createUntitledFile },
    { id: 'file.save', label: locale === 'zh-CN' ? '文件: 保存' : 'File: Save', shortcut: 'Ctrl+S', action: saveFile },
    { id: 'file.saveAll', label: locale === 'zh-CN' ? '文件: 全部保存' : 'File: Save All', shortcut: 'Ctrl+Shift+S', action: saveAllFiles },
    { id: 'view.explorer', label: locale === 'zh-CN' ? '视图: 资源管理器' : 'View: Show Explorer', shortcut: 'Ctrl+Shift+E', action: () => setSidebarView('explorer') },
    { id: 'view.search', label: locale === 'zh-CN' ? '视图: 搜索' : 'View: Show Search', shortcut: 'Ctrl+Shift+F', action: () => setSidebarView('search') },
    { id: 'view.git', label: locale === 'zh-CN' ? '视图: 源码管理' : 'View: Show Source Control', shortcut: 'Ctrl+Shift+G', action: () => setSidebarView('git') },
    { id: 'view.extensions', label: locale === 'zh-CN' ? '视图: 扩展' : 'View: Show Extensions', action: () => setSidebarView('extensions') },
    { id: 'view.outline', label: locale === 'zh-CN' ? '视图: 代码大纲' : 'View: Show Outline', action: () => setSidebarView('outline') },
    { id: 'view.terminal', label: locale === 'zh-CN' ? '视图: 切换终端' : 'View: Toggle Terminal', shortcut: 'Ctrl+`', action: () => setPanelVisible(p => !p) },
    { id: 'view.sidebar', label: locale === 'zh-CN' ? '视图: 切换侧边栏' : 'View: Toggle Sidebar', shortcut: 'Ctrl+B', action: () => setSidebarView(v => v ? '' : 'explorer') },
    { id: 'view.commandPalette', label: locale === 'zh-CN' ? '视图: 命令面板' : 'View: Command Palette', shortcut: 'Ctrl+Shift+P', action: () => setCmdPalette(true) },
    { id: 'view.splitEditor', label: locale === 'zh-CN' ? '视图: 分屏编辑' : 'View: Split Editor', shortcut: 'Ctrl+\\', action: () => setSplitMode(p => !p) },
    { id: 'ai.toggle', label: locale === 'zh-CN' ? 'AI: 切换面板' : 'AI: Toggle Panel', action: () => setAiOpen(p => !p) },
    { id: 'settings.open', label: locale === 'zh-CN' ? '首选项: 打开设置' : 'Preferences: Open Settings', shortcut: 'Ctrl+,', action: () => setSettingsOpen(true) },
    { id: 'theme.dark', label: locale === 'zh-CN' ? '主题: 深色' : 'Color Theme: Dark', action: () => { applyTheme('dark'); window.loom?.settings?.set?.('theme', 'dark'); } },
    { id: 'theme.light', label: locale === 'zh-CN' ? '主题: 浅色' : 'Color Theme: Light', action: () => { applyTheme('light'); window.loom?.settings?.set?.('theme', 'light'); } },
    { id: 'theme.system', label: locale === 'zh-CN' ? '主题: 跟随系统' : 'Color Theme: System', action: () => { applyTheme('system'); window.loom?.settings?.set?.('theme', 'system'); } },
    { id: 'file.revert', label: locale === 'zh-CN' ? '文件: 重新载入' : 'File: Revert File', action: () => window.dispatchEvent(new CustomEvent('loom:revert-file')) },
    { id: 'file.history', label: locale === 'zh-CN' ? '文件: 查看本地历史' : 'File: Local History', action: () => { const f = openFiles[activeIdx]; if (f?.path) setHistoryTarget(f.path); } },
    { id: 'editor.format', label: locale === 'zh-CN' ? '编辑器: 格式化文档' : 'Editor: Format Document', shortcut: 'Shift+Alt+F', action: () => window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'format' } })) },
    { id: 'editor.comment', label: locale === 'zh-CN' ? '编辑器: 切换行注释' : 'Editor: Toggle Line Comment', shortcut: 'Ctrl+/', action: () => window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'toggleComment' } })) },
    { id: 'debug.run', label: locale === 'zh-CN' ? '运行: 不调试运行' : 'Run: Run Without Debugging', shortcut: 'Ctrl+F5', action: runCurrentFile },
    { id: 'workspace.rules', label: locale === 'zh-CN' ? '工作区: 编辑规则 (.loomrules)' : 'Workspace: Edit Rules (.loomrules)', action: () => {
      if (!workspace) { addNotification(locale === 'zh-CN' ? '请先打开工作区' : 'Open a workspace first', 'warning'); return; }
      const rulesPath = workspace.replace(/[\\/]/g, '/').replace(/\/$/, '') + '/.loomrules';
      window.loom.fs.exists(rulesPath).then(async (exists: boolean) => {
        if (!exists) {
          const defaultRules = `# Loom IDE Rules
# Add your project-specific instructions for AI here.
# These rules are included in every AI chat message.
`;
          await window.loom.fs.writeFile(rulesPath, defaultRules);
        }
        const content = await window.loom.fs.readFile(rulesPath);
        addOrFocusFile(rulesPath, content);
      }).catch(() => addNotification(locale === 'zh-CN' ? '无法创建/打开规则文件' : 'Failed to create/open rules file', 'error'));
    }},
  ], [locale, workspace, openFiles, activeIdx, openFileFromDisk, openFolder, closeWorkspace, createUntitledFile, saveFile, saveAllFiles, applyTheme, runCurrentFile, addOrFocusFile, addNotification]);

  const reorderTabs = useCallback((from: number, to: number) => {
    setOpenFiles(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
    setActiveIdx(prev => {
      if (prev === from) return to;
      if (from < prev && to >= prev) return prev - 1;
      if (from > prev && to <= prev) return prev + 1;
      return prev;
    });
  }, []);

  const toggleSplit = useCallback(() => {
    setSplitMode(prev => {
      if (!prev) {
        setSplitIdx(prev => Math.min(prev, Math.max(0, openFiles.length - 1)));
        setSplitRatio(50);
        setFocusSide('left');
      }
      return !prev;
    });
  }, [openFiles.length]);

  const closeSplit = useCallback((side: 'left' | 'right') => {
    setSplitMode(false);
    if (side === 'right') {
      setActiveIdx(splitIdx >= 0 && splitIdx < openFiles.length ? splitIdx : activeIdx);
    }
  }, [splitIdx, openFiles.length, activeIdx]);

  // 分屏守卫：恢复布局后若文件数不足或 splitIdx 越界，自动校正，避免 EditorGroup 拿到非法索引
  useEffect(() => {
    if (!splitMode) return;
    if (openFiles.length < 2) {
      setSplitMode(false);
    } else if (splitIdx < 0 || splitIdx >= openFiles.length) {
      setSplitIdx(openFiles.length - 1);
    }
  }, [splitMode, openFiles.length, splitIdx]);

  const activeFile = openFiles[activeIdx] || null;
  const hasDirty = openFiles.some(f => isFileDirty(f.content, f.originalContent));
  const hasStale = openFiles.some(f => staleFilesRef.current.has(f.path));
  // Provide a way for child components to know if the active file is stale.
  // 仅在变更真正发生时定向刷新（见文件监听 / 重新载入 / 保存中的 setStaleVersion 调用），
  // 不再使用每 2s 的全局重渲染定时器。
  const [, setStaleVersion] = useState(0);

  return (
    <div className="app">
      <TitleBar
        title={
          activeFile
            ? (activeFile.name + (hasDirty ? ' ●' : '') + (staleFilesRef.current.has(activeFile.path) ? ' ⟳' : '') + ' - Loom IDE')
            : 'Loom IDE'
        }
        menuItems={menuItems}
      />
      <div className="main-layout">
        <ActivityBar
          activeView={sidebarView}
          onViewChange={setSidebarView}
          aiOpen={aiOpen}
          onToggleAI={() => setAiOpen(!aiOpen)}
          onSettings={() => setSettingsOpen(true)}
        />
        {sidebarView && (
          <div style={{ position: 'relative' }}>
            <ErrorBoundary name={locale === 'zh-CN' ? '侧边栏' : 'Sidebar'}>
              <Sidebar
                view={sidebarView}
                workspacePath={workspace}
                onOpenFile={addOrFocusFile}
                onOpenFolder={openFolder}
                onCloseFolder={closeWorkspace}
                selectedFile={selectedFile}
                sidebarWidth={sidebarWidth}
                gitStatusMap={gitStatusMap}
                locale={locale}
              />
            </ErrorBoundary>
            <div
              className="resize-handle resize-handle-v"
              style={{ right: -2 }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = sidebarWidth;
                let currentWidth = startW;
                const onMove = (ev: MouseEvent) => {
                  currentWidth = Math.max(160, Math.min(600, startW + ev.clientX - startX));
                  setSidebarWidth(currentWidth);
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div className="editor-area">
            {openFiles.length > 0 && !splitMode && (
              <TabBar
                files={openFiles}
                activeIdx={activeIdx}
                onSelect={setActiveIdx}
                onClose={closeTab}
                onCloseAll={closeAllTabs}
                onCloseOthers={closeOtherTabs}
                onReorder={reorderTabs}
                onRun={startDebug}
                onSplit={toggleSplit}
                onRevert={(idx) => {
                  const f = openFiles[idx];
                  if (f?.path) revertFile(f.path);
                }}
                locale={locale}
                staleFiles={staleFilesRef.current}
              />
            )}
            {activeFile && !splitMode && (
              <Breadcrumb filePath={activeFile.path} onOpenFile={addOrFocusFile} />
            )}
            <div className={`editor-wrapper editor-container ${isDraggingFile ? 'drag-active' : ''}`}>
              <ErrorBoundary name={locale === 'zh-CN' ? '编辑器' : 'Editor'}>
                {splitMode ? (
                  <EditorGroup
                    openFiles={openFiles}
                    leftIdx={activeIdx}
                    rightIdx={splitIdx}
                    splitDirection="horizontal"
                    splitRatio={splitRatio}
                    onLeftIdxChange={setActiveIdx}
                    onRightIdxChange={setSplitIdx}
                    onRatioChange={setSplitRatio}
                    onContentChange={handleContentChange}
                    onCloseSplit={closeSplit}
                    onFocusSide={setFocusSide}
                    focusSide={focusSide}
                    workspacePath={workspace}
                  />
                ) : (
                  <Editor file={activeFile} openFilePaths={openFiles.map(f => f.path)} onContentChange={handleContentChange} workspacePath={workspace} />
                )}
              </ErrorBoundary>
              {isDraggingFile && (
                <div className="drop-zone">
                  <div className="drop-zone-text">松开鼠标以打开文件</div>
                </div>
              )}
            </div>
          </div>
          <ErrorBoundary name={locale === 'zh-CN' ? '底部面板' : 'Bottom Panel'}>
            <Panel
              visible={panelVisible}
              height={panelHeight}
              onClose={() => setPanelVisible(false)}
              onResize={setPanelHeight}
              problems={problems}
              outputLines={outputLines}
              workspacePath={workspace}
            />
          </ErrorBoundary>
        </div>
        {aiOpen && (
          <div style={{ display: 'flex', flexShrink: 0, position: 'relative' }}>
            <div
              className="resize-handle resize-handle-v"
              style={{ left: -2, cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = aiPanelWidth;
                const onMove = (ev: MouseEvent) => {
                  setAiPanelWidth(clampAssistantPanelWidth(startW + startX - ev.clientX));
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            />
            <ErrorBoundary name={locale === 'zh-CN' ? 'AI 面板' : 'AI Panel'}>
              <AIAgent
                workspacePath={workspace}
                onClose={() => setAiOpen(false)}
                openFiles={openFiles.map(f => ({ path: f.path, name: f.name, content: f.content }))}
                onOpenFile={addOrFocusFile}
                onApplyEdit={(filePath, content) => {
                  handleContentChange(filePath, content);
                  addOrFocusFile(filePath, content);
                }}
                width={aiPanelWidth}
                locale={locale}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <StatusBar
        workspacePath={workspace}
        activeFile={activeFile}
        agentStatus={agentStatus}
        aiMode={aiMode}
        orcaOnline={orcaOnline}
        theme={theme}
        onThemeChange={(t) => { applyTheme(t); window.loom?.settings?.set?.('theme', t); }}
        locale={locale}
        gitBranch={gitBranch}
        rulesActive={!!workspaceRules}
      />
      <CommandPalette
        visible={cmdPalette}
        commands={commands}
        onClose={() => setCmdPalette(false)}
        workspacePath={workspace}
        onOpenFile={addOrFocusFile}
      />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} locale={locale} />}
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />
      <ConfirmModal />
      {historyTarget && (
        <LocalHistory
          filePath={historyTarget}
          onClose={() => setHistoryTarget(null)}
          onRestore={async (content) => {
            // Apply snapshot content to the editor via the active file
            const f = openFiles[activeIdx];
            if (!f) return;
            await window.loom?.history?.restore?.(f.path, content);
            handleContentChange(f.path, content);
            // Mark as dirty so user can save (or save directly)
            await saveFile();
            setHistoryTarget(null);
          }}
          locale={locale}
        />
      )}
    </div>
  );
}
