import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { t } from '@/shared/i18n';
import { buildCommands, buildMenuItems } from './app-commands';
import { useNotifications } from './hooks/useNotifications';
import { useThemeLocale } from './hooks/useThemeLocale';
import { useGitStatus } from './hooks/useGitStatus';
import { emitLoomEvent, onLoomEvent } from './loom-events';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  originalContent: string;
  /**
   * 预览标签（VS Code 语义）：单击打开、可被下一个单击替换；编辑/双击后转为正式标签。
   */
  isPreview?: boolean;
  /**
   * Incrementally-maintained dirty flag (content !== originalContent), updated
   * at mutation points so render-path checks stay O(1) per file instead of
   * doing a full string comparison on every keystroke.
   */
  dirty?: boolean;
  /**
   * Set when the session restore truncated this file's content to fit in
   * localStorage. Saving truncated content would permanently destroy the
   * on-disk file, so saveFile/saveAllFiles refuse to write while this is set.
   */
  contentTruncated?: boolean;
}

export default function App() {
  const [layout] = useState(loadLayout);
  const [panelState] = useState(loadPanelState);
  // 会话改为异步恢复（磁盘存储）：首帧先空，挂载后 loadSession() 填充
  const sessionRef = useRef<{ openFiles: OpenFile[]; activeIdx: number; workspace: string } | null>(null);

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [sidebarView, setSidebarView] = useState<string>(layout.activeView);
  const [sidebarWidth, setSidebarWidth] = useState(layout.sidebarWidth);
  const [panelVisible, setPanelVisible] = useState(panelState.visible);
  const [panelHeight, setPanelHeight] = useState(layout.panelHeight);
  const [cmdPalette, setCmdPalette] = useState(false);
  const [untitledCount, setUntitledCount] = useState(1);
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
  // 领域 hook：通知队列 + 主题/语言（App.tsx 模块化拆分）
  const { notifications, addNotification, dismissNotification } = useNotifications();
  const { theme, locale, applyTheme, setTheme, setLocale } = useThemeLocale();
  const [splitMode, setSplitMode] = useState(layout.splitMode ?? false);
  const [splitRatio, setSplitRatio] = useState(layout.splitRatio ?? 50);
  const [splitIdx, setSplitIdx] = useState(layout.splitIdx ?? 0);
  const [focusSide, setFocusSide] = useState<'left' | 'right'>('left');
  // 领域 hook：Git 状态（轮询 + 即时刷新）
  const { gitStatusMap, gitBranch, refreshGitStatus } = useGitStatus(workspace);
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

  // ==== File watcher ====
  useEffect(() => {
    if (!workspace) return;
    window.loom?.watcher?.start?.(workspace).catch(() => {});
    const cleanup = window.loom?.watcher?.onChange?.((_cwd: string, changedPaths: string[]) => {
      refreshGitStatus();
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
  }, [workspace, refreshGitStatus]);

  // Re-read a file from disk and refresh the open file's content (Revert).
  const revertFile = useCallback(async (filePath: string) => {
    try {
      const fresh = await window.loom.fs.readFile(filePath);
      setOpenFiles(prev => prev.map(f => f.path === filePath
        ? { ...f, content: fresh, originalContent: fresh, dirty: false }
        : f));
      staleFilesRef.current.delete(filePath);
      setStaleVersion(v => v + 1);
      emitLoomEvent('loom:notify', { message: t('app.reloadedFromDisk', { file: filePath.split(/[\\/]/).pop() ?? '' }), type: 'info' },);
    } catch (e: any) {
      emitLoomEvent('loom:notify', { message: t('app.reloadFailed', { msg: e.message }), type: 'error' },);
    }
  }, []);

  // Expose revert to menu / command palette via a custom event.
  useEffect(() => {
    const offRevert = onLoomEvent('loom:revert-file', () => {
      const f = openFiles[activeIdx];
      if (f && f.path) revertFile(f.path);
    });
    const offHistory = onLoomEvent('loom:open-history', () => {
      const f = openFiles[activeIdx];
      if (f?.path) setHistoryTarget(f.path);
    });
    return () => {
      offRevert();
      offHistory();
    };
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

  // 会话恢复（异步磁盘加载，fire-and-forget）
  useEffect(() => {
    let cancelled = false;
    loadSession().then(s => {
      if (cancelled || !s) return;
      sessionRef.current = s;
      setOpenFiles(s.openFiles);
      setActiveIdx(Math.min(s.activeIdx, Math.max(0, s.openFiles.length - 1)));
      setWorkspace(s.workspace);
      setUntitledCount(Math.max(1, s.openFiles.filter(f => f.path.startsWith('untitled-')).length + 1));
      setSidebarView(v => v || (s.workspace ? 'explorer' : 'explorer'));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 会话持久化（1.5s 防抖 → 主进程磁盘原子写）
  useEffect(() => {
    if (saveSessionTimer.current) clearTimeout(saveSessionTimer.current);
    saveSessionTimer.current = setTimeout(() => {
      saveSession({ openFiles, activeIdx, workspace }).catch(() => {});
    }, 1500);
    return () => { if (saveSessionTimer.current) clearTimeout(saveSessionTimer.current); };
  }, [openFiles, activeIdx, workspace]);

  useEffect(() => {
    return onLoomEvent('loom:clear-output', () => setOutputLines([]));
  }, []);

  useEffect(() => {
    return onLoomEvent('loom:diagnostics', detail => setProblems(detail || []));
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
  }, [workspace, aiOpen]);

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
          dirty: false,        });
      }
      if (toAdd.length > 0) {
        const merged = [...currentOpen, ...toAdd];
        const newIdx = merged.length - 1;
        queueMicrotask(() => {
          setActiveIdx(newIdx);
          setSelectedFile(toAdd[toAdd.length - 1]!.path);
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
        addNotification(t('app.folderOpened', { folder: result.folder.split(/[\\/]/).pop() ?? '' }), 'info', 2500);
      } else {
        addNotification(t('app.cannotOpenFolder', { folder: result.message || folder }), 'error', 4000);
      }
    } catch {
      addNotification(t('app.cannotOpenFolder', { folder }), 'error', 4000);
    }
  }, [addNotification]);

  const addOrFocusFile = useCallback((filePath: string, content: string) => {
    if (isFsReadError(content)) {
      addNotification(t('app.cannotOpenFile', { file: fsReadErrorMessage(content) }), 'error', 6000);
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

  // Problems 面板点击：打开文件并跳转到对应行（首次打开时等编辑器挂载再跳）。
  const openFileAndJump = useCallback(async (filePath: string, line?: number) => {
    const base = workspace ? workspace.replace(/[\\/]+$/, '') : '';
    const abs = filePath.startsWith(workspace) || !base ? filePath : base + '/' + filePath;
    try {
      const content = await window.loom.fs.readFile(abs);
      if (isFsReadError(content)) return;
      addOrFocusFile(abs, content);
      if (line && line > 0) {
        setTimeout(() => {
          emitLoomEvent('loom:go-to-line', { line });
        }, 80);
      }
    } catch { /* file may have moved */ }
  }, [workspace, addOrFocusFile]);

  const closeWorkspace = useCallback(async () => {
    const dirty = openFiles.filter(f => isFileDirty(f.content, f.originalContent));
    if (dirty.length > 0) {
      const ok = await confirmDialog.ask({
        title: t('app.closeFolderTitle'),
        message: t('app.closeFolderConfirm', { count: dirty.length }),
        confirmText: t('app.close'),
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
    addNotification(t('app.folderClosed'), 'info', 2500);
  }, [openFiles, addNotification]);

  const createUntitledFile = useCallback(() => {
    const name = 'untitled-' + untitledCount;
    setUntitledCount(c => c + 1);
    addOrFocusFile(name, '');
  }, [untitledCount, addOrFocusFile]);

  const handleContentChange = useCallback((filePath: string, newContent: string) => {
    setOpenFiles(prev => prev.map(f => {
      if (f.path !== filePath) return f;
      // 开始编辑预览标签 → 自动钉住（转为正式标签），与 VS Code 一致
      const willDirty = isFileDirty(newContent, f.originalContent);
      return { ...f, content: newContent, dirty: willDirty, isPreview: f.isPreview && !willDirty ? true : false };
    }));
  }, []);

  /** 钉住预览标签（双击文件树 / 点击标签时调用）。 */
  const pinFile = useCallback((filePath: string) => {
    setOpenFiles(prev => prev.map(f => (f.path === filePath ? { ...f, isPreview: false } : f)));
  }, []);

  // 文件树双击 → 钉住预览标签
  useEffect(() => {
    return onLoomEvent('loom:pin-file', filePath => pinFile(filePath));
  }, [pinFile]);

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
          ? { ...x, path: newPath, name: newName, originalContent: f.content, dirty: false, isPreview: false }
          : x));
        setSelectedFile(newPath);
        addNotification(t('app.fileSaved', { file: newName }), 'success');
      } catch (e: any) {
        addNotification(t('app.saveAsFailed', { msg: e.message }), 'error');
      }
      return;
    }
    try {
      // DATA-SAFETY: never write session-truncated content back over the real
      // on-disk file — that would permanently destroy the original text.
      if (f.contentTruncated) {
        addNotification(t('app.saveBlockedTruncated', { name: f.name }), 'error');
        return;
      }
      await window.loom.fs.writeFile(f.path, f.content);
      setOpenFiles(prev => prev.map(x => x === f ? { ...x, originalContent: f.content, dirty: false, isPreview: false } : x));
      staleFilesRef.current.delete(f.path);
      // 记录保存时间戳，让 watcher 在 1.5s 内忽略该路径的 stale 标记
      recentlySavedRef.current.set(f.path, Date.now());
      setStaleVersion(v => v + 1);
      addNotification(t('app.fileSaved', { file: f.name }), 'success');
    } catch (e: any) {
      addNotification(t('app.saveFailed', { file: f.name, msg: e.message }), 'error');
    }
  }, [addNotification]);

  const saveAllFiles = useCallback(async () => {
    // Read current values from refs
    const currentFiles = openFilesRef.current;
    const filesToSave = currentFiles.filter(f => isFileDirty(f.content, f.originalContent));
    if (filesToSave.length === 0) {
      addNotification(t('app.nothingToSave'), 'info');
      return;
    }
    const failed: string[] = [];
    const saved: string[] = [];
    for (const f of filesToSave) {
      try {
        if (f.contentTruncated) {
          // DATA-SAFETY: same guard as saveFile — truncated session content
          // must never overwrite the real file on disk.
          failed.push(t('app.saveBlockedTruncatedShort', { name: f.name }));
          continue;
        }
        if (!f.path || f.path.startsWith('untitled-')) {
          const result = await window.loom.dialog.saveFile(f.name) as { canceled?: boolean; filePath?: string } | null;
          if (!result || result.canceled || !result.filePath) continue;
          await window.loom.fs.writeFile(result.filePath, f.content);
          const newPath = result.filePath;
          const newName = newPath.split(/[/\\]/).pop() || newPath;
          setOpenFiles(prev => prev.map(x => x === f
            ? { ...x, path: newPath, name: newName, originalContent: f.content, dirty: false }
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
      setOpenFiles(prev => prev.map(f => saved.includes(f.path) ? { ...f, originalContent: f.content, dirty: false } : f));
      // 记录保存时间戳，让 watcher 在 1.5s 内忽略这些路径的 stale 标记
      const now = Date.now();
      saved.forEach(p => recentlySavedRef.current.set(p, now));
    }
    if (failed.length > 0) {
      addNotification(t('app.someSaveFailed', { count: failed.length }), 'error');
    } else {
      addNotification(t('app.someSaveSucceeded', { count: saved.length }), 'success');
    }
  }, [openFiles, addNotification]);

  const addOutput = useCallback((msg: string) => {
    setOutputLines(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ==== Debugger ====
  const startDebug = useCallback(async () => {
    setPanelVisible(true);
    emitLoomEvent('loom:open-panel-tab', 'output');
    const f = openFilesRef.current[activeIdxRef.current];
    if (!f) { addOutput(t('app.debugOpenFileFirst')); return; }
    if (!workspace) { addOutput(t('app.debugOpenFolderFirst')); return; }
    if (isDebugging) { addOutput(t('app.debugSessionRunning')); return; }

    addOutput(t('app.debugStarting', { file: f.path }));
    try {
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
        debugCleanupRef.current = null;
      }
      const result = await window.loom.debug?.start?.(f.path, workspace);
      if (result?.ok) {
        addOutput('Debug: ' + (result.message || t('app.debugStartedFallback')));
        setIsDebugging(true);
        const cleanupFns: (() => void)[] = [];
        const removeStdout = window.loom.debug?.onStdout?.((data: string) => addOutput('[stdout] ' + data.trim()));
        const removeStderr = window.loom.debug?.onStderr?.((data: string) => addOutput('[stderr] ' + data.trim()));
        const removeExit = window.loom.debug?.onExit?.((code: number | null) => {
          addOutput(t('app.debugProcessExited', { code: String(code) }));
          setIsDebugging(false);
        });
        if (removeStdout) cleanupFns.push(removeStdout);
        if (removeStderr) cleanupFns.push(removeStderr);
        if (removeExit) cleanupFns.push(removeExit);
        debugCleanupRef.current = () => cleanupFns.forEach(fn => fn());
      } else {
        addOutput(t('app.debugStartFailed') + (result?.message || t('app.debugUnknownError')));
      }
    } catch (e: any) {
      addOutput(t('app.debugError') + e.message);
    }
  }, [workspace, isDebugging]);

  const runAbortRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => { runAbortRef.current?.(); runAbortRef.current = null; };
  }, []);

  const runCurrentFile = useCallback(async () => {
    setPanelVisible(true);
    emitLoomEvent('loom:open-panel-tab', 'output');
    const f = openFilesRef.current[activeIdxRef.current];
    if (!f) { addOutput(t('app.runOpenFileFirst')); return; }
    if (!workspace) { addOutput(t('app.runOpenFolderFirst')); return; }
    if (isRunning) {
      // 再次按下 = 停止当前运行（与 VS Code 的终止语义一致）
      runAbortRef.current?.();
      addOutput(t('app.runStopped'));
      return;
    }

    const ext = f.path.split('.').pop()?.toLowerCase() || '';
    let cmd = '';
    if (ext === 'ts' || ext === 'tsx') cmd = `npx tsx "${f.path}"`;
    else if (ext === 'js' || ext === 'mjs') cmd = `node "${f.path}"`;
    else if (ext === 'py') cmd = `python "${f.path}"`;
    else if (ext === 'go') cmd = `go run "${f.path}"`;
    else if (ext === 'rs') cmd = `cargo run`;
    else if (ext === 'sh') cmd = `bash "${f.path}"`;
    else if (ext === 'ps1') cmd = `powershell -File "${f.path}"`;
    else { addOutput(t('app.runUnsupportedType', { ext })); return; }

    setIsRunning(true);
    addOutput(t('app.runStarting', { file: f.path.split(/[\\/]/).pop() ?? '' }));
    try {
      const abort = window.loom?.verification?.runStream?.(
        workspace,
        cmd,
        (stream, data) => { if (data) addOutput(data); },
        (result) => {
          const code = result.exitCode ?? -1;
          if (code === 0) {
            addOutput(t('app.runFinished', { code: String(code) }));
          } else {
            const tail = (result.stderr || result.error || '').trim().split('\n').slice(-5).join('\n');
            addOutput(t('app.runFailed', { code: String(code), msg: tail ? `\n${tail}` : '' }));
          }
          setIsRunning(false);
        },
      );
      runAbortRef.current = abort || null;
    } catch (e: any) {
      addOutput(t('app.runError', { msg: e.message }));
      setIsRunning(false);
    }
  }, [workspace, isRunning, addOutput]);

  const stopDebug = useCallback(async () => {
    if (!isDebugging) { addOutput(t('app.debugNoSession')); return; }
    addOutput(t('app.debugStopping'));
    try {
      await window.loom.debug?.stop?.();
      addOutput(t('app.debugStopped'));
      setIsDebugging(false);
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
        debugCleanupRef.current = null;
      }
    } catch (e: any) {
      addOutput(t('app.debugStopError', { msg: e.message }));
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
        title: t('app.closeTabTitle'),
        message: t('app.closeTabConfirm', { name: target.name }),
        confirmText: t('app.close'),
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
        title: t('app.closeAllTitle'),
        message: t('app.closeAllConfirm', { count: dirty.length }),
        confirmText: t('app.closeAll'),
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
        title: t('app.closeOthersTitle'),
        message: t('app.closeOthersConfirm', { count: dirty.length }),
        confirmText: t('app.closeOthers'),
        danger: true,
      });
      if (!ok) return;
    }
    setOpenFiles([target]);
    setActiveIdx(0);
    setSelectedFile(target.path);
  }, [openFiles]);

  // ==== Ctrl+Tab MRU 标签切换 ====
  const tabMruRef = useRef<string[]>([]);
  useEffect(() => {
    const f = openFiles[activeIdx];
    if (f) {
      tabMruRef.current = [f.path, ...tabMruRef.current.filter(p => p !== f.path)].slice(0, 30);
    }
  }, [activeIdx, openFiles]);
  const cycleTabs = useCallback((dir: 1 | -1) => {
    const active = openFiles[activeIdx]?.path;
    const mru = tabMruRef.current;
    const idx = active ? mru.indexOf(active) : -1;
    const next = (idx >= 0 ? mru[idx + dir] : undefined) || mru[0];
    if (!next) return;
    const targetIdx = openFiles.findIndex(f => f.path === next);
    if (targetIdx >= 0) setActiveIdx(targetIdx);
  }, [openFiles, activeIdx]);

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
      cycleTabs,
    },
    { openFilesCount: openFiles.length, activeIdx, isDebugging },
  );

  // ==== Welcome page command listener ====
  useEffect(() => {
    const offCmd = onLoomEvent('loom:cmd', (cmd) => {
      if (cmd === 'openFile') openFileFromDisk();
      else if (cmd === 'openFolder') openFolder();
      else if (cmd === 'newFile') createUntitledFile();
      else if (cmd === 'openSettings') setSettingsOpen(true);
      else if (cmd === 'closeFolder') closeWorkspace();
      else if (cmd === 'toggleAI') setAiOpen(p => !p);
    });
    const offFolder = onLoomEvent('loom:open-folder-path', folder => openFolderByPath(folder));
    const offSave = onLoomEvent('loom:save-file', ({ all }) => {
      if (all) saveAllFiles();
      else saveFile();
    });
    // CLI / loom:// 协议 / 单实例二次启动：主进程请求打开文件夹
    const offAppOpen = window.loom?.app?.onOpenFolderRequest?.(folder => openFolderByPath(folder));
    return () => {
      offCmd();
      offFolder();
      offSave();
      offAppOpen?.();
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
  // 菜单与命令面板定义已抽到 app-commands.ts（模块化：纯函数 + 依赖注入）
  const menuItems = React.useMemo(() => buildMenuItems({
    workspace,
    openFiles,
    activeIdx,
    theme,
    createUntitledFile,
    openFileFromDisk,
    openFolder,
    closeWorkspace,
    saveFile,
    saveAllFiles,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    startDebug,
    stopDebug,
    runCurrentFile,
    applyTheme,
    addNotification,
    setHistoryTarget,
    setSettingsOpen,
    setCmdPalette,
    setSidebarView,
    setPanelVisible,
    setSplitMode,
  }), [workspace, openFiles, activeIdx, theme, createUntitledFile, openFileFromDisk, openFolder, closeWorkspace, saveFile, saveAllFiles, closeTab, closeOtherTabs, closeAllTabs, startDebug, stopDebug, runCurrentFile, applyTheme, addNotification, setHistoryTarget, setSettingsOpen, setCmdPalette, setSidebarView, setPanelVisible, setSplitMode]);

  const commands = React.useMemo(() => buildCommands({
    workspace,
    openFiles,
    activeIdx,
    openFileFromDisk,
    openFolder,
    closeWorkspace,
    createUntitledFile,
    saveFile,
    saveAllFiles,
    runCurrentFile,
    addOrFocusFile,
    applyTheme,
    addNotification,
    setHistoryTarget,
    setSettingsOpen,
    setCmdPalette,
    setAiOpen,
    setSidebarView,
    setPanelVisible,
    setSplitMode,
  }), [workspace, openFiles, activeIdx, openFileFromDisk, openFolder, closeWorkspace, createUntitledFile, saveFile, saveAllFiles, runCurrentFile, addOrFocusFile, applyTheme, addNotification, setHistoryTarget, setSettingsOpen, setCmdPalette, setAiOpen, setSidebarView, setPanelVisible, setSplitMode]);

  const reorderTabs = useCallback((from: number, to: number) => {
    setOpenFiles(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item!);
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
  // O(1)-per-file dirty check: relies on the incrementally-maintained `dirty`
  // flag; files whose flag was never set fall back to the full comparison.
  const hasDirty = useMemo(
    () => openFiles.some(f => f.dirty === true || (f.dirty === undefined && isFileDirty(f.content, f.originalContent))),
    [openFiles],
  );
  // Provide a way for child components to know if the active file is stale.
  // 仅在变更真正发生时定向刷新（见文件监听 / 重新载入 / 保存中的 setStaleVersion 调用），
  // 不再使用每 2s 的全局重渲染定时器。
  const [, setStaleVersion] = useState(0);

  // ==== 渲染性能：稳定 props（避免每次按键全树重渲染）====
  // AIAgent 不再每键收到全量文件内容快照：1.2s 防抖后更新，输入过程中
  // AI 面板不随按键重渲染（文件内容通过 @mention/发送时从磁盘按需读取）。
  // 未变化的文件保留旧对象引用，避免无谓的分配与下游 memo 失效。
  const [aiContextFiles, setAiContextFiles] = useState(
    () => openFiles.map(f => ({ path: f.path, name: f.name, content: f.content })),
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setAiContextFiles(prev => {
        let changed = false;
        const next = openFiles.map((f, i) => {
          const p = prev[i];
          if (p && p.path === f.path && p.name === f.name && p.content === f.content) return p;
          changed = true;
          return { path: f.path, name: f.name, content: f.content };
        });
        return changed ? next : prev;
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [openFiles]);

  const openFilePaths = useMemo(() => openFiles.map(f => f.path), [openFiles]);
  const aiPanelOnClose = useCallback(() => setAiOpen(false), []);
  const aiPanelOnApplyEdit = useCallback((filePath: string, content: string) => {
    handleContentChange(filePath, content);
    addOrFocusFile(filePath, content);
    // 若该文件已在编辑器中打开，强制同步模型内容（Editor 的 memo 比较器
    // 会忽略 content 变化，因此外部修改必须显式驱动）。
    emitLoomEvent('loom:editor-set-content', { path: filePath, content });
  }, [handleContentChange, addOrFocusFile]);

  // ==== F8/Shift+F8：下一个/上一个问题 ====
  const problemsNavRef = useRef(0);
  useEffect(() => {
    return onLoomEvent('loom:problems-next', ({ dir }) => {
      const d = dir === -1 ? -1 : 1;
      if (problems.length === 0) return;
      problemsNavRef.current = (problemsNavRef.current + d + problems.length) % problems.length;
      const p = problems[problemsNavRef.current];
      if (p?.file) openFileAndJump(p.file, p.line);
    });
  }, [problems, openFileAndJump]);

  return (
    <div className="app">
      <ErrorBoundary name="TitleBar">
        <TitleBar
          title={
            activeFile
              ? (activeFile.name + (hasDirty ? ' ●' : '') + (staleFilesRef.current.has(activeFile.path) ? ' ⟳' : '') + ' - Loom IDE')
              : 'Loom IDE'
          }
          menuItems={menuItems}
        />
      </ErrorBoundary>
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
            <ErrorBoundary name={t('app.sidebar')}>
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
                onPin={pinFile}
                locale={locale}
                staleFiles={staleFilesRef.current}
              />
            )}
            {activeFile && !splitMode && (
              <Breadcrumb filePath={activeFile.path} onOpenFile={addOrFocusFile} />
            )}
            <div className={`editor-wrapper editor-container ${isDraggingFile ? 'drag-active' : ''}`}>
              <ErrorBoundary name={t('app.editor')}>
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
                  <Editor file={activeFile} openFilePaths={openFilePaths} onContentChange={handleContentChange} workspacePath={workspace} />
                )}
              </ErrorBoundary>
              {isDraggingFile && (
                <div className="drop-zone">
                  <div className="drop-zone-text">{t('app.dropToOpenFile')}</div>
                </div>
              )}
            </div>
          </div>
          <ErrorBoundary name={t('app.bottomPanel')}>
            <Panel
              visible={panelVisible}
              height={panelHeight}
              onClose={() => setPanelVisible(false)}
              onResize={setPanelHeight}
              problems={problems}
              outputLines={outputLines}
              workspacePath={workspace}
              onOpenFile={openFileAndJump}
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
            <ErrorBoundary name={t('app.aiPanel')}>
              <AIAgent
                workspacePath={workspace}
                onClose={aiPanelOnClose}
                openFiles={aiContextFiles}
                onOpenFile={addOrFocusFile}
                onApplyEdit={aiPanelOnApplyEdit}
                width={aiPanelWidth}
                locale={locale}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <ErrorBoundary name="StatusBar">
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
      </ErrorBoundary>
      <ErrorBoundary name="CommandPalette">
        <CommandPalette
          visible={cmdPalette}
          commands={commands}
          onClose={() => setCmdPalette(false)}
          workspacePath={workspace}
          onOpenFile={addOrFocusFile}
        />
      </ErrorBoundary>
      {settingsOpen && (
        <ErrorBoundary name="Settings">
          <Settings onClose={() => setSettingsOpen(false)} locale={locale} />
        </ErrorBoundary>
      )}
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />
      <ConfirmModal />
      {historyTarget && (
        <ErrorBoundary name="LocalHistory">
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
        </ErrorBoundary>
      )}
    </div>
  );
}
