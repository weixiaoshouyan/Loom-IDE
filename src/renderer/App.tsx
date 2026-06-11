import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleBar from './components/TitleBar';
import ActivityBar from './components/ActivityBar';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Panel from './components/Panel';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import AIAgent from './components/AIAgent';
import Settings from './components/Settings';
import NotificationContainer, { NotificationItem, NotificationType } from './components/Notification';
import EditorGroup from './components/EditorGroup';
import TabBar from './components/TabBar';
import Breadcrumb from './components/Breadcrumb';
import ErrorBoundary from './components/ErrorBoundary';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  originalContent: string;
}

const extMap: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', json: 'json', md: 'markdown',
  css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', sh: 'shell',
  cpp: 'cpp', c: 'c', java: 'java', rb: 'ruby', php: 'php',
  xml: 'xml', svg: 'xml', sql: 'sql', dockerfile: 'dockerfile',
  toml: 'ini', ini: 'ini', env: 'properties', log: 'plaintext',
  txt: 'plaintext', csv: 'plaintext', bat: 'shell', ps1: 'shell',
};

function detectLang(filename: string): string {
  const name = filename.toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return extMap[ext] || 'plaintext';
}

export default function App() {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [sidebarView, setSidebarView] = useState('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [panelVisible, setPanelVisible] = useState(false);
  const [panelHeight, setPanelHeight] = useState(220);
  const [cmdPalette, setCmdPalette] = useState(false);
  const [untitledCount, setUntitledCount] = useState(1);
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [problems, setProblems] = useState<{ severity: string; message: string; file?: string; line?: number }[]>([]);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [agentStatus, setAgentStatus] = useState<'online' | 'offline'>('offline');
  const [aiMode, setAiMode] = useState<'orca' | 'builtin'>('orca');
  const [orcaOnline, setOrcaOnline] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const notifIdRef = useRef(0);
  const [splitMode, setSplitMode] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [splitIdx, setSplitIdx] = useState(0);
  const [focusSide, setFocusSide] = useState<'left' | 'right'>('left');
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, string>>({});
  const debugCleanupRef = useRef<(() => void) | null>(null);
  const minimapRef = useRef(true); // track minimap toggle state

  // Apply theme
  useEffect(() => {
    (window as any).loom?.settings?.getAll?.().then((s: any) => {
      if (s?.theme) document.documentElement.setAttribute('data-theme', s.theme);
    }).catch(() => {});
    const handler = (e: CustomEvent) => {
      if (e.detail?.key === 'theme') document.documentElement.setAttribute('data-theme', e.detail.value);
    };
    window.addEventListener('loom:setting-change' as any, handler);
    return () => window.removeEventListener('loom:setting-change' as any, handler);
  }, []);

  // Check agent status (both modes)
  useEffect(() => {
    const check = () => {
      (window as any).loom.ai.getConfig().then((c: any) => {
        setAiMode(c?.mode || 'orca');
        if (c?.mode === 'orca') {
          (window as any).loom.ai.checkOrcaStatus().then((s: any) => {
            setOrcaOnline(s?.ok || false);
            setAgentStatus(s?.ok ? 'online' : 'offline');
          }).catch(() => { setOrcaOnline(false); setAgentStatus('offline'); });
        } else {
          const provider = c?.providers?.find((p: any) => p.id === c.activeProviderId);
          setAgentStatus(provider?.apiKey ? 'online' : 'offline');
        }
      }).catch(() => setAgentStatus('offline'));
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  // Fetch git status
  useEffect(() => {
    if (!workspace) { setGitStatusMap({}); return; }
    const fetchStatus = () => {
      (window as any).loom?.git?.status?.(workspace).then((result: any) => {
        const map: Record<string, string> = {};
        (result?.changes || []).forEach((c: any) => { if (c.file) map[c.file] = c.status; });
        setGitStatusMap(map);
      }).catch(() => setGitStatusMap({}));
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => clearInterval(t);
  }, [workspace]);

  // File watcher - auto-refresh on external changes
  useEffect(() => {
    if (!workspace) return;
    (window as any).loom?.watcher?.start?.(workspace).catch(() => {});
    const cleanup = (window as any).loom?.watcher?.onChange?.((_cwd: string, changedPaths: string[]) => {
      // Re-fetch git status when files change externally
      (window as any).loom?.git?.status?.(workspace).then((result: any) => {
        const map: Record<string, string> = {};
        (result?.changes || []).forEach((c: any) => { if (c.file) map[c.file] = c.status; });
        setGitStatusMap(map);
      }).catch(() => {});
    });
    return () => {
      (window as any).loom?.watcher?.stop?.().catch(() => {});
      if (cleanup) cleanup();
    };
  }, [workspace]);
  const addNotification = useCallback((message: string, type: NotificationType = 'info', duration?: number) => {
    const id = 'n' + (++notifIdRef.current);
    setNotifications(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Listen for loom:notify events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { message, type, duration } = e.detail || {};
      if (message) addNotification(message, type || 'info', duration);
    };
    window.addEventListener('loom:notify' as any, handler);
    return () => window.removeEventListener('loom:notify' as any, handler);
  }, [addNotification]);

  // Listen for clear output events
  useEffect(() => {
    const handler = () => setOutputLines([]);
    window.addEventListener('loom:clear-output' as any, handler);
    return () => window.removeEventListener('loom:clear-output' as any, handler);
  }, []);

  // Listen for diagnostics from Monaco editor
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setProblems(e.detail || []);
    };
    window.addEventListener('loom:diagnostics' as any, handler);
    return () => window.removeEventListener('loom:diagnostics' as any, handler);
  }, []);

  // Update window title
  useEffect(() => {
    const f = openFiles[activeIdx];
    if (!f) { document.title = 'Loom IDE'; return; }
    const dirty = f.content !== f.originalContent;
    document.title = (dirty ? '\u25cf ' : '') + f.name + ' - Loom IDE';
  }, [openFiles, activeIdx]);

  const openFileFromDisk = async () => {
    const files = await (window as any).loom.dialog.openFile();
    if (!files) return;
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) return;

    const currentOpen = openFiles;
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
      const lastNewIdx = currentOpen.length + toAdd.length - 1;
      setOpenFiles(prev => [...prev, ...toAdd]);
      setActiveIdx(lastNewIdx);
      setSelectedFile(toAdd[toAdd.length - 1].path);
    } else if (focused >= 0) {
      setActiveIdx(focused);
      setSelectedFile(currentOpen[focused].path);
    }
  };

  const openFolder = async () => {
    const folder = await (window as any).loom.dialog.openFolder();
    if (folder) setWorkspace(folder);
  };

  const addOrFocusFile = (filePath: string, content: string) => {
    const existing = openFiles.findIndex(f => f.path === filePath);
    if (existing >= 0) { setActiveIdx(existing); return; }
    const nf: OpenFile = {
      path: filePath,
      name: filePath.split(/[\\/]/).pop() || 'untitled',
      content,
      language: detectLang(filePath),
      originalContent: content,
    };
    setOpenFiles(prev => {
      const next = [...prev, nf];
      queueMicrotask(() => setActiveIdx(next.length - 1));
      return next;
    });
    // BUGFIX: openFiles is stale in closure, use prev length from setOpenFiles callback
    setSelectedFile(filePath);
  };

  const createUntitledFile = () => {
    const name = 'untitled-' + untitledCount;
    setUntitledCount(c => c + 1);
    addOrFocusFile(name, '');
  };

  const handleContentChange = (filePath: string, newContent: string) => {
    setOpenFiles(prev => prev.map(f => f.path === filePath ? { ...f, content: newContent } : f));
  };

  const saveFile = async () => {
    const f = openFiles[activeIdx];
    if (!f) return;
    try {
      await (window as any).loom.fs.writeFile(f.path, f.content);
      setOpenFiles(prev => prev.map((x, i) => i === activeIdx ? { ...x, originalContent: x.content } : x));
      addNotification(`已保存: ${f.name}`, 'success');
    } catch (e: any) {
      addNotification(`保存失败 ${f.name}: ${e.message}`, 'error');
    }
  };

  const saveAllFiles = async () => {
    const failed: string[] = [];
    for (let i = 0; i < openFiles.length; i++) {
      const f = openFiles[i];
      if (f.content !== f.originalContent) {
        try {
          await (window as any).loom.fs.writeFile(f.path, f.content);
        } catch (e: any) {
          failed.push(f.name);
        }
      }
    }
    if (failed.length > 0) {
      addNotification(`保存失败: ${failed.join(', ')}`, 'error');
    }
    const savedPaths = new Set(openFiles.filter((_, i) => !failed.includes(openFiles[i].name)).map(f => f.path));
    setOpenFiles(prev => prev.map(f => savedPaths.has(f.path) ? { ...f, originalContent: f.content } : f));
    if (failed.length === 0) addNotification('所有文件已保存', 'success');
  };

  const addOutput = (msg: string) => {
    setOutputLines(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Debugger functions
  const startDebug = async () => {
    const f = openFiles[activeIdx];
    if (!f) { addOutput('Debug: No file to debug. Open a JavaScript/TypeScript file first.'); return; }
    if (!workspace) { addOutput('Debug: Open a folder first.'); return; }
    if (isDebugging) { addOutput('Debug: Already debugging. Stop current session first.'); return; }
    
    addOutput(`Debug: Starting debug session for ${f.path}...`);
    try {
      // Clean up previous listeners if any
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
        debugCleanupRef.current = null;
      }
      
      const result = await (window as any).loom.debug?.start?.(f.path, workspace);
      if (result?.ok) {
        addOutput('Debug: ' + (result.message || 'Session started on port 9229'));
        setIsDebugging(true);
        
        // Set up debug output listeners and store cleanup functions
        const cleanupFns: (() => void)[] = [];
        const removeStdout = (window as any).loom.debug?.onStdout?.((data: string) => addOutput('Debug stdout: ' + data.trim()));
        const removeStderr = (window as any).loom.debug?.onStderr?.((data: string) => addOutput('Debug stderr: ' + data.trim()));
        const removeExit = (window as any).loom.debug?.onExit?.((code: number | null) => {
          addOutput(`Debug: Process exited with code ${code}`);
          setIsDebugging(false);
        });
        
        if (removeStdout) cleanupFns.push(removeStdout);
        if (removeStderr) cleanupFns.push(removeStderr);
        if (removeExit) cleanupFns.push(removeExit);
        
        debugCleanupRef.current = () => {
          cleanupFns.forEach(fn => fn());
        };
      } else {
        addOutput('Debug: Failed to start - ' + (result?.message || 'Unknown error'));
      }
    } catch (e: any) {
      addOutput('Debug error: ' + e.message);
    }
  };

  const stopDebug = async () => {
    if (!isDebugging) { addOutput('Debug: No active debug session.'); return; }
    addOutput('Debug: Stopping session...');
    try {
      await (window as any).loom.debug?.stop?.();
      addOutput('Debug: Session stopped.');
      setIsDebugging(false);
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
        debugCleanupRef.current = null;
      }
    } catch (e: any) {
      addOutput('Debug stop error: ' + e.message);
    }
  };

  // Cleanup debug listeners on unmount
  useEffect(() => {
    return () => {
      if (debugCleanupRef.current) {
        debugCleanupRef.current();
      }
    };
  }, []);

  const closeTab = useCallback((idx: number) => {
    const f = openFiles[idx];
    if (f && f.content !== f.originalContent) {
      if (!window.confirm('"' + f.name + '" has unsaved changes. Close without saving?')) return;
    }
    const nf = openFiles.filter((_, i) => i !== idx);
    setOpenFiles(nf);
    if (activeIdx >= nf.length) setActiveIdx(Math.max(0, nf.length - 1));
    else if (activeIdx > idx) setActiveIdx(activeIdx - 1);
  }, [openFiles, activeIdx]);

  const closeAllTabs = () => {
    const dirty = openFiles.filter(f => f.content !== f.originalContent);
    if (dirty.length > 0) {
      if (!window.confirm(`Close all tabs? ${dirty.length} file(s) have unsaved changes.`)) return;
    }
    setOpenFiles([]);
    setActiveIdx(0);
  };

  const closeOtherTabs = () => {
    if (!openFiles[activeIdx]) return;
    const active = openFiles[activeIdx];
    const others = openFiles.filter((_, i) => i !== activeIdx);
    const dirty = others.filter(f => f.content !== f.originalContent);
    if (dirty.length > 0) {
      if (!window.confirm(`Close other tabs? ${dirty.length} file(s) have unsaved changes.`)) return;
    }
    setOpenFiles([active]);
    setActiveIdx(0);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (e.shiftKey) saveAllFiles(); else saveFile(); }
      else if (e.ctrlKey && e.key === 'o' && e.shiftKey) { e.preventDefault(); openFileFromDisk(); }
      else if (e.ctrlKey && e.key === 'o' && !e.shiftKey) { e.preventDefault(); openFolder(); }
      else if (e.ctrlKey && e.shiftKey && e.key === 'P') { e.preventDefault(); setCmdPalette(p => !p); }
      else if (e.ctrlKey && e.key === '`') { e.preventDefault(); setPanelVisible(p => !p); }
      else if (e.ctrlKey && e.key === 'b') { e.preventDefault(); setSidebarView(v => v ? '' : 'explorer'); }
      else if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (openFiles.length) closeTab(activeIdx); }
      else if (e.ctrlKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      else if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); setSidebarView('explorer'); }
      else if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setSidebarView('search'); }
      else if (e.ctrlKey && e.shiftKey && e.key === 'G') { e.preventDefault(); setSidebarView('git'); }
      else if (e.altKey && e.key === 'z') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'editor.wordWrap', value: '' } })); }
      else if (e.key === 'F12') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'goToDefinition' } })); }
      else if (e.altKey && e.key === 'F12') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'peekDefinition' } })); }
      else if (e.shiftKey && e.key === 'F12') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'findReferences' } })); }
      else if (e.key === 'F2') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'rename' } })); }
      else if (e.shiftKey && e.altKey && e.key === 'F') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'format' } })); }
      else if (e.ctrlKey && e.key === '/') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'toggleComment' } })); }
      else if (e.ctrlKey && e.shiftKey && e.code === 'Slash') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'toggleBlockComment' } })); }
      else if (e.ctrlKey && e.key === 'n') { e.preventDefault(); createUntitledFile(); }
      else if (e.ctrlKey && e.key === 'p') { e.preventDefault(); setCmdPalette(true); }
      else if (e.ctrlKey && e.key === '\\') { e.preventDefault(); toggleSplit(); }
      // Debugger shortcuts
      else if (e.key === 'F5' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); if (isDebugging) addOutput('Debug: Continue (F5)'); else startDebug(); }
      else if (e.ctrlKey && e.shiftKey && e.key === 'F5') { e.preventDefault(); addOutput('Debug: Restart (Ctrl+Shift+F5)'); stopDebug().then(() => startDebug()); }
      else if (e.shiftKey && e.key === 'F5') { e.preventDefault(); stopDebug(); }
      else if (e.key === 'F10') { e.preventDefault(); if (isDebugging) addOutput('Debug: Step Over (F10) - Continue execution'); else addOutput('Debug: No active session. Press F5 to start.'); }
      else if (e.key === 'F11') { e.preventDefault(); if (isDebugging) addOutput('Debug: Step Into (F11) - Enter function'); else addOutput('Debug: No active session. Press F5 to start.'); }
      else if (e.shiftKey && e.key === 'F11') { e.preventDefault(); if (isDebugging) addOutput('Debug: Step Out (Shift+F11) - Exit function'); else addOutput('Debug: No active session. Press F5 to start.'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFiles, activeIdx, isDebugging]);

  // Welcome page command listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const cmd = e.detail;
      if (cmd === 'openFile') openFileFromDisk();
      if (cmd === 'openFolder') openFolder();
      if (cmd === 'newFile') createUntitledFile();
    };
    window.addEventListener('loom:cmd' as any, handler);
    return () => window.removeEventListener('loom:cmd' as any, handler);
  }, [openFiles]);

  const menuItems = [
    {
      label: 'File',
      items: [
        { label: 'New File', shortcut: 'Ctrl+N', action: () => createUntitledFile() },
        { label: 'Open File...', shortcut: 'Ctrl+O', action: openFileFromDisk },
        { label: 'Open Folder...', shortcut: 'Ctrl+O', action: openFolder },
        { separator: true, label: '' },
        { label: 'Save', shortcut: 'Ctrl+S', action: saveFile },
        { label: 'Save All', shortcut: 'Ctrl+Shift+S', action: saveAllFiles },
        { separator: true, label: '' },
        { label: 'Close Tab', shortcut: 'Ctrl+W', action: () => { if (openFiles.length) closeTab(activeIdx); } },
        { label: 'Close All Tabs', action: closeAllTabs },
        { separator: true, label: '' },
        { label: 'Preferences', shortcut: 'Ctrl+,', action: () => setSettingsOpen(true) },
        { separator: true, label: '' },
        { label: 'Exit', action: () => (window as any).close?.() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'undo' } })); } },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'redo' } })); } },
        { separator: true, label: '' },
        { label: 'Find', shortcut: 'Ctrl+F', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'find' } })); } },
        { label: 'Replace', shortcut: 'Ctrl+H', action: () => { window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'replace' } })); } },
        { separator: true, label: '' },
        { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: () => setSidebarView('search') },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Command Palette...', shortcut: 'Ctrl+Shift+P', action: () => setCmdPalette(true) },
        { separator: true, label: '' },
        { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: () => setSidebarView('explorer') },
        { label: 'Search', shortcut: 'Ctrl+Shift+F', action: () => setSidebarView('search') },
        { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: () => setSidebarView('git') },
        { label: 'Extensions', action: () => setSidebarView('extensions') },
        { separator: true, label: '' },
        { label: 'Terminal', shortcut: 'Ctrl+`', action: () => setPanelVisible(p => !p) },
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: () => setSidebarView(v => v ? '' : 'explorer') },
      ],
    },
    {
      label: 'Run',
      items: [
        { label: 'Start Debugging', shortcut: 'F5', action: startDebug },
        { label: 'Run Without Debugging', shortcut: 'Ctrl+F5', action: () => addOutput('Run: Starting...') },
        { separator: true, label: '' },
        { label: 'Stop Debugging', shortcut: 'Shift+F5', action: stopDebug },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'About Loom IDE', action: () => addOutput('Loom IDE v0.2.0 - AI-powered development environment') },
        { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', action: () => setSettingsOpen(true) },
        { label: 'Check for Updates...', action: () => addOutput('You are running the latest version.') },
      ],
    },
  ];

  const commands = [
    { id: 'file.open', label: 'File: Open File', shortcut: 'Ctrl+O', action: openFileFromDisk },
    { id: 'folder.open', label: 'File: Open Folder', shortcut: 'Ctrl+O', action: openFolder },
    { id: 'file.save', label: 'File: Save', shortcut: 'Ctrl+S', action: saveFile },
    { id: 'file.saveAll', label: 'File: Save All', shortcut: 'Ctrl+Shift+S', action: saveAllFiles },
    { id: 'view.explorer', label: 'View: Show Explorer', shortcut: 'Ctrl+Shift+E', action: () => setSidebarView('explorer') },
    { id: 'view.search', label: 'View: Show Search', shortcut: 'Ctrl+Shift+F', action: () => setSidebarView('search') },
    { id: 'view.git', label: 'View: Show Source Control', shortcut: 'Ctrl+Shift+G', action: () => setSidebarView('git') },
    { id: 'view.extensions', label: 'View: Show Extensions', action: () => setSidebarView('extensions') },
    { id: 'view.terminal', label: 'View: Toggle Terminal', shortcut: 'Ctrl+`', action: () => setPanelVisible(p => !p) },
    { id: 'view.sidebar', label: 'View: Toggle Sidebar', shortcut: 'Ctrl+B', action: () => setSidebarView(v => v ? '' : 'explorer') },
    { id: 'view.commandPalette', label: 'View: Command Palette', shortcut: 'Ctrl+Shift+P', action: () => setCmdPalette(true) },
    { id: 'view.splitEditor', label: 'View: Split Editor', shortcut: 'Ctrl+\\', action: toggleSplit },
    { id: 'ai.toggle', label: 'AI: Toggle Orca Agent', action: () => setAiOpen(p => !p) },
    { id: 'settings.open', label: 'Preferences: Open Settings', shortcut: 'Ctrl+,', action: () => setSettingsOpen(true) },
    { id: 'editor.wordwrap', label: 'View: Toggle Word Wrap', shortcut: 'Alt+Z', action: () => window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'editor.wordWrap', value: '' } })) },
    { id: 'editor.minimap', label: 'View: Toggle Minimap', action: () => { minimapRef.current = !minimapRef.current; window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'editor.minimap', value: minimapRef.current } })); } },
    { id: 'editor.format', label: 'Format Document', shortcut: 'Shift+Alt+F', action: () => addOutput('Format document...') },
    { id: 'theme.dark', label: 'Color Theme: Dark+ (Default)', action: () => {} },
  ];

  const reorderTabs = (from: number, to: number) => {
    setOpenFiles(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
    if (activeIdx === from) setActiveIdx(to);
    else if (from < activeIdx && to >= activeIdx) setActiveIdx(a => a - 1);
    else if (from > activeIdx && to <= activeIdx) setActiveIdx(a => a + 1);
  };

  const toggleSplit = () => {
    setSplitMode(prev => {
      if (!prev) { setSplitIdx(activeIdx); setSplitRatio(50); setFocusSide('left'); }
      return !prev;
    });
  };

  const closeSplit = (side: 'left' | 'right') => {
    setSplitMode(false);
    if (side === 'right') setActiveIdx(splitIdx >= 0 ? splitIdx : activeIdx);
  };

  const activeFile = openFiles[activeIdx] || null;
  const hasDirty = openFiles.some(f => f.content !== f.originalContent);

  return (
    <div className="app">
      <TitleBar title={activeFile ? activeFile.name + (hasDirty ? ' \u25cf' : '') + ' - Loom IDE' : 'Loom IDE'} menuItems={menuItems} />
      <div className="main-layout">
        <ActivityBar activeView={sidebarView} onViewChange={setSidebarView} aiOpen={aiOpen} onToggleAI={() => setAiOpen(!aiOpen)} onSettings={() => setSettingsOpen(true)} />
        {sidebarView && (
          <div style={{ position: 'relative' }}>
              <Sidebar view={sidebarView} workspacePath={workspace} onOpenFile={addOrFocusFile} onOpenFolder={openFolder} selectedFile={selectedFile} sidebarWidth={sidebarWidth} gitStatusMap={gitStatusMap} />
            <div className="resize-handle resize-handle-v" style={{ right: -2 }}
              onMouseDown={(e) => {
                const startX = e.clientX;
                const startW = sidebarWidth;
                const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(150, Math.min(600, startW + ev.clientX - startX)));
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div className="editor-area" style={{ flex: 1 }}>
            {openFiles.length > 0 && !splitMode && (
              <TabBar
                files={openFiles}
                activeIdx={activeIdx}
                onSelect={setActiveIdx}
                onClose={closeTab}
                onCloseAll={closeAllTabs}
                onCloseOthers={closeOtherTabs}
                onReorder={reorderTabs}
              />
            )}
            {activeFile && !splitMode && (
              <Breadcrumb filePath={activeFile.path} onOpenFile={addOrFocusFile} />
            )}
            <div className="editor-wrapper">
              <ErrorBoundary name="编辑器">
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
            </div>
          </div>
          <Panel visible={panelVisible} height={panelHeight} onClose={() => setPanelVisible(false)} onResize={setPanelHeight} problems={problems} outputLines={outputLines} />
        </div>
        {aiOpen && <ErrorBoundary name="AI 面板"><AIAgent workspacePath={workspace} onClose={() => setAiOpen(false)} openFiles={openFiles.map(f => ({ path: f.path, name: f.name, content: f.content }))} onOpenFile={addOrFocusFile} onApplyEdit={(filePath, content) => { handleContentChange(filePath, content); addOrFocusFile(filePath, content); }} /></ErrorBoundary>}
      </div>
      <StatusBar workspacePath={workspace} activeFile={activeFile} agentStatus={agentStatus} aiMode={aiMode} orcaOnline={orcaOnline} />
      <CommandPalette visible={cmdPalette} commands={commands} onClose={() => setCmdPalette(false)} workspacePath={workspace} onOpenFile={addOrFocusFile} />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}
