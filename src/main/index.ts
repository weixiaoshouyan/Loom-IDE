/**
 * Loom IDE — main process entry.
 *
 * Responsibilities (and nothing else):
 *   1. Create the main window.
 *   2. Initialize singletons (AIEngine, PluginManager, MCPClient, SkillManager).
 *   3. Wire up all IPC handler modules (each handles its own domain).
 *   4. Manage app lifecycle (tray, auto-updater, cleanup on quit).
 *
 * All IPC handlers live in focused modules under src/main/*.ts. This file is
 * purely orchestration — no handler logic should be added here.
 */
import './crash-handler';
import { trace, clearTrace } from './startup-trace';
clearTrace();
trace('module-load-start');

import { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen, dialog, ipcMain, protocol } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import { AIEngine } from '../agent/ai-engine';
import { PluginManager } from './plugin-manager';
import { registerMarketplaceIPC } from './extension-marketplace';
import { SkillManager } from '../agent/skills';
import { MCPClient } from '../agent/mcp-client';
import { buildCodeIndex, loadCodeIndex, saveCodeIndex, searchCodeIndex } from '../agent/code-index';
import { CloudSyncManager } from './cloud-sync';
import { telemetry } from './telemetry';
import { DevelopmentCommandQueue } from '../agent/development-command';
import { extractPathFromArgv, extractPathFromLoomUrl } from './cli-path';

// ---- Handler modules (each registers its own IPC via setXxxSingletons) -------
import { getUserData, getDataDir, getConfigPath, ensureDataDir, loadConfig, saveConfig } from './config';
import { registerGitHandlers } from './git-handlers';
import { setMainWindow, registerTerminalHandlers, killAllTerminals, getActiveTerminalsSnapshot } from './terminal-mgmt';
import { registerFileHandlers } from './file-handlers';
import { setMainWindowForWatcher, registerFileWatcherHandlers, stopFileWatcher } from './file-watcher';
import { registerHistoryHandlers, stopHistoryCleanupTimer } from './history-handlers';
import { registerDebugRuntimeHandlers } from './debug-runtime-handlers';
import { registerSessionHandlers } from './session-handlers';
import { setTerminalRuntimeGetter, setStreamRuntimeGetter, setPermissionRuntimeGetter, setPluginRuntimeGetter } from './runtime-state';
import { registerConversationHandlers } from './conversations-handlers';
import { registerSettingsHandlers, registerCodeIndexHandlers } from './settings-handlers';
import { setMainWindowForDialog, registerDialogHandlers } from './dialog-handlers';
import { registerShellHandlers, setPathPerms, setShellMainWindow, killAllRuns } from './shell-handlers';
import { getPermissionSnapshot } from './path-permissions';
import { setMainWindowForControls, registerWindowHandlers } from './window-handlers';
import { setMainWindowForDebugger, registerDebuggerHandlers, killDebugger } from './debugger-handlers';
import { registerFileIndexHandlers } from './file-index-handlers';
import { registerAIHandlers, setAIStreamSingletons, abortAllStreams, getActiveStreamsSnapshot } from './ai-stream-handlers';
import { registerAIConfigHandlers, setAIEngineForConfigHandlers } from './ai-config-handlers';
import { registerSkillsHandlers, registerMcpHandlers, setSkillsMcpSingletons } from './skills-mcp-handlers';
import { registerTeamHandlers, setCloudSyncForHandlers } from './team-handlers';
import { registerTelemetryHandlers } from './telemetry-handlers';
import { registerCliAgentHandlers } from './cli-agent-handlers';
import { registerCommandPolicyHandlers } from './command-policy-handlers';
import { setPluginSingletons, registerPluginHandlers } from './plugin-handlers';
import { reloadCommandPolicy } from './command-policy';
import { PathPermissionStore, setCurrentPermissionStore } from './path-permissions';

// ====== Singletons ===========================================================
let mainWindow: BrowserWindow | null = null;
let aiEngine: AIEngine | null = null;
let pluginManager: PluginManager | null = null;
let skillManager: SkillManager | null = null;
let mcpClient: MCPClient | null = null;
const cloudSyncManager = new CloudSyncManager();
const pathPermissions = new PathPermissionStore();
const agentCommandQueue = new DevelopmentCommandQueue();

// E2E runs must never touch (or inherit state from) the user's real profile:
// point userData at a throwaway temp dir before anything reads config.
// This also gives each launch its own single-instance lock, so tests don't
// collide with a dev instance the developer has open.
if (process.env.E2E === '1') {
  const e2eUserData = path.join(require('os').tmpdir(), `loom-e2e-${process.pid}-${Date.now()}`);
  fs.mkdirSync(e2eUserData, { recursive: true });
  app.setPath('userData', e2eUserData);
}

// Expose command queue globally for handler modules.
(global as any).__loom_mainWindow = null;
(global as any).__loom_commandQueue = agentCommandQueue;

// ====== Renderer Loading (custom protocol) ===================================
// Production loads the renderer via the privileged `loom-app://` scheme
// instead of a localhost HTTP server: no port to collide on or drift, and no
// other local process can reach the app's pages. The OS-level `loom://`
// deep-link scheme is separate and unaffected.
const PROD_APP_URL = 'loom-app://app/index.html';
const DEV_APP_URL = 'http://localhost:5174';

protocol.registerSchemesAsPrivileged([
  { scheme: 'loom-app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function registerProdProtocol() {
  const ROOT = path.join(__dirname, '../renderer');
  const MIME: Record<string, string> = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  };
  protocol.handle('loom-app', async (request) => {
    try {
      const { pathname } = new URL(request.url);
      const safePath = decodeURIComponent(pathname).replace(/^[/\\]+/, '');
      let filePath = path.resolve(ROOT, safePath);
      const rootPath = path.resolve(ROOT);
      if (!filePath.startsWith(rootPath + path.sep) && filePath !== rootPath) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(ROOT, 'index.html');
      }
      const ext = path.extname(filePath);
      const body = await fs.promises.readFile(filePath);
      return new Response(body, { status: 200, headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } });
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

async function waitForUrl(url: string, timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return false;
}

// ====== Window ===============================================================
function createWindow() {
  const cfg = loadConfig();
  const theme = cfg.theme || 'dark';
  const ws = cfg.windowState;
  const isDev = process.env.NODE_ENV === 'development';

  // Restore window position clamped to a visible display: after an external
  // monitor is unplugged, saved x/y can land the window off-screen.
  const savedW = ws?.width || 1400;
  const savedH = ws?.height || 900;
  let savedX = ws?.x;
  let savedY = ws?.y;
  try {
    if (savedX !== undefined && savedY !== undefined) {
      const wa = screen.getDisplayMatching({ x: savedX, y: savedY, width: savedW, height: savedH }).workArea;
      savedX = Math.min(Math.max(savedX, wa.x), wa.x + wa.width - Math.min(savedW, wa.width));
      savedY = Math.min(Math.max(savedY, wa.y), wa.y + wa.height - Math.min(savedH, wa.height));
    }
  } catch { /* keep saved position on display detection failure */ }

  mainWindow = new BrowserWindow({
    width: savedW, height: savedH,
    x: savedX, y: savedY,
    minWidth: 900, minHeight: 600,
    title: 'Loom IDE',
    icon: path.join(__dirname, '../../resources/icon.ico'),
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: theme === 'dark' ? '#3c3c3c' : '#f3f3f3',
      symbolColor: theme === 'dark' ? '#cccccc' : '#333333',
      height: 30,
    },
    show: false,
    backgroundColor: theme === 'dark' ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Wire the new window into every handler module.
  wireWindow(mainWindow);

  // SECURITY: never let the renderer navigate to, or open, external content.
  // A new BrowserWindow spawned via window.open would inherit this window's
  // preload, letting an external site call window.loom.* (fs, shell, git)
  // with the user's privileges. Deny all popups; open http(s)/mailto in the
  // system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const appOrigin = new URL(isDev ? DEV_APP_URL : PROD_APP_URL).origin;
      if (new URL(url).origin === appOrigin) return;
    } catch { /* malformed URL falls through to preventDefault */ }
    event.preventDefault();
  });

  if (ws?.maximized) mainWindow.maximize();

  const loadUrl = isDev ? DEV_APP_URL : PROD_APP_URL;

  // 渲染进程崩溃/无响应恢复（成熟 IDE 标配）：崩溃后自动重载页面，
  // 卡死时提示用户选择「等待」或「重新加载」。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Loom] renderer process gone:', details.reason);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    } catch { /* window destroyed */ }
  });
  mainWindow.webContents.on('unresponsive', () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['等待', '重新加载'],
        defaultId: 0,
        cancelId: 0,
        title: 'Loom IDE 无响应',
        message: '界面无响应。可以等待恢复，或重新加载页面（未保存的内容会保留在编辑器中）。',
      }).then(({ response }) => {
        if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      }).catch(() => {});
    } catch { /* ignore */ }
  });

  mainWindow.loadURL(loadUrl).catch((err) => {
    console.error('Failed to load URL, retrying once:', err);
    // The window may be closed while loadURL is in flight. Accessing a
    // destroyed window throws — so the whole fallback is wrapped in try/catch.
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.loadURL(loadUrl).catch(() => {
        console.error('Retry load also failed');
      });
    } catch (e) {
      console.error('Window destroyed during fallback load:', e);
    }
  });

  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
    mainWindow!.focus();
  });

  // Fallback: if the window never became visible (e.g. renderer crash), show
  // it after a timeout. Do not force-focus or re-open devtools when the
  // window is already up and running.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  // CRITICAL: the window is gone — every handler module still holds a
  // reference to this BrowserWindow. Accessing a destroyed window's
  // `.webContents` (or calling its methods) throws "Object has been
  // destroyed", which previously flooded the audit log via uncaughtException
  // (node-pty onData callbacks firing after close are the common trigger).
  // Null out every module reference so their send helpers become no-ops.
  mainWindow.on('closed', () => {
    mainWindow = null;
    (global as any).__loom_mainWindow = null;
    setMainWindow(null);
    setMainWindowForWatcher(null);
    setMainWindowForDialog(null);
    setMainWindowForControls(null);
    setMainWindowForDebugger(null);
    setShellMainWindow(null);
    setAIStreamSingletons({
      mainWindow: null,
      aiEngine: aiEngine!,
      mcpClient,
      skillManager,
      cloudSync: cloudSyncManager,
      commandQueue: agentCommandQueue,
    });
  });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));

  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const isMax = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    const cfg = loadConfig();
    cfg.windowState = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, maximized: isMax };
    saveConfig(cfg);
  });
}

/**
 * Wire the given BrowserWindow into every handler module that needs it.
 * Called once from createWindow().
 */
function wireWindow(win: BrowserWindow) {
  (global as any).__loom_mainWindow = win;

  // Terminal / watcher / dialog / controls / debugger route output through mainWindow.
  setMainWindow(win);
  setMainWindowForWatcher(win);
  setMainWindowForDialog(win);
  setMainWindowForControls(win);
  setMainWindowForDebugger(win);
  setShellMainWindow(win.webContents);

  // AI streaming modules share the same singleton set.
  setAIStreamSingletons({
    mainWindow: win,
    aiEngine: aiEngine!,
    mcpClient,
    skillManager,
    cloudSync: cloudSyncManager,
    commandQueue: agentCommandQueue,
  });
}

// =============================================================================
//                              APP LIFECYCLE
// =============================================================================
let tray: Tray | null = null;

// ---- 单实例锁 + CLI 参数 + loom:// 协议（成熟 IDE 标配）----
// 第二次启动不再新开实例：把参数转给已有实例并退出。
const gotLock = app.requestSingleInstanceLock();

/** 把「打开文件夹」请求发给主窗口渲染进程（窗口未就绪时排队到 did-finish-load）。 */
function requestOpenFolder(folder: string) {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:open-folder', folder); } catch {}
    });
  } else {
    win.webContents.send('app:open-folder', folder);
  }
}

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const folder = extractPathFromArgv(argv);
    if (folder) requestOpenFolder(folder);
  });
  // loom:// 协议：浏览器/终端 `loom://open?path=...` 打开工作区
  app.setAsDefaultProtocolClient('loom');
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const folder = extractPathFromLoomUrl(url);
    if (folder) requestOpenFolder(folder);
  });
}

app.on('ready', () => trace('app-ready-event'));
app.on('will-quit', () => trace('will-quit'));
app.on('quit', () => trace('quit'));

app.whenReady().then(async () => {
  trace('whenReady-resolved');
  if (!gotLock) return; // 非首实例：app.quit() 已调用
  try {
    ensureDataDir();
    // Load the user-configurable command policy (falls back to defaults when app isn't ready).
    reloadCommandPolicy();

    // ---- Initialize singletons ----
    const cfg = loadConfig();
    skillManager = new SkillManager();
    mcpClient = new MCPClient(cfg.mcpServers || undefined);
    mcpClient.onUpdateConfig((servers) => {
      const fullCfg = loadConfig();
      fullCfg.mcpServers = servers;
      saveConfig(fullCfg);
    });
    aiEngine = new AIEngine(cfg.aiConfig || undefined, skillManager, mcpClient);
    aiEngine.onUpdateConfig((newAiCfg) => {
      const fullCfg = loadConfig();
      fullCfg.aiConfig = newAiCfg;
      saveConfig(fullCfg);
    });
    pluginManager = new PluginManager();
    pluginManager.onWebviewEvent((event) => {
      mainWindow?.webContents.send('plugins:webview-event', event);
    });

    // ---- Push singletons into handler modules ----
    setAIEngineForConfigHandlers(aiEngine);
    setSkillsMcpSingletons(skillManager, mcpClient);
    setCloudSyncForHandlers(cloudSyncManager);
    setPathPerms(pathPermissions);
    // Wire the shared PathPermissionStore into the module-level permission
    // wrappers (grantRoot/canAccess/ensurePathAllowed/...) used by every
    // handler. Without this, the store is never initialized and every
    // permission check throws "PathPermissionStore not initialized", which
    // breaks opening folders, file I/O, git, watchers, etc.
    setCurrentPermissionStore(pathPermissions);
    setPluginSingletons(null /* window set later in wireWindow */, pluginManager);

    // ---- Register all IPC handlers ----
    registerAIHandlers();
    registerAIConfigHandlers();
    registerGitHandlers();
    registerTerminalHandlers();
    registerFileHandlers();
    registerFileWatcherHandlers();
    registerHistoryHandlers();
    registerConversationHandlers();
    registerSettingsHandlers();
    registerCodeIndexHandlers();
    registerDialogHandlers();
    registerShellHandlers();
    registerWindowHandlers();
    registerDebuggerHandlers();
    registerFileIndexHandlers();
    registerSkillsHandlers();
    registerMcpHandlers();
    registerTeamHandlers();
    registerTelemetryHandlers();
    registerCliAgentHandlers();
    registerCommandPolicyHandlers();
    registerPluginHandlers();
    registerMarketplaceIPC();
    registerDebugRuntimeHandlers();
    registerSessionHandlers();
    trace('after-ipc-register');

    // ---- Wire runtime-state snapshot getters ----
    setTerminalRuntimeGetter(getActiveTerminalsSnapshot);
    setStreamRuntimeGetter(getActiveStreamsSnapshot);
    setPermissionRuntimeGetter(getPermissionSnapshot);
    setPluginRuntimeGetter(() => pluginManager ? pluginManager.getAllPlugins().map((p) => ({
      id: p.id, name: p.manifest.displayName || p.manifest.name, version: p.manifest.version, enabled: p.enabled,
    })) : []);

    // ---- Activate plugins ----
    pluginManager.activateAll();

    // ---- Load renderer (prod: custom protocol; dev: wait for Vite) ----
    if (process.env.NODE_ENV === 'development') {
      await waitForUrl(DEV_APP_URL);
    } else {
      registerProdProtocol();
    }

    // ---- Create the window ----
    createWindow();
    trace('after-createWindow');

    // CLI：`loom <folder>` 打开工作区（首实例启动参数）
    const cliFolder = extractPathFromArgv(process.argv);
    if (cliFolder) {
      requestOpenFolder(cliFolder);
    }

    // ---- Auto updater ----
    try {
      autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdater] Update available:', info.version);
        mainWindow?.webContents.send('update:available', {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      });
      autoUpdater.on('update-not-available', () => {
        mainWindow?.webContents.send('update:not-available');
      });
      autoUpdater.on('error', (err) => {
        console.warn('[AutoUpdater] Error:', err);
        mainWindow?.webContents.send('update:error', String(err?.message || err));
      });
      // Update feed resolution order: LOOM_UPDATE_URL env override > package.json
      // publish url. The packaged default stays a placeholder until a real
      // update server exists — checking it every launch would always fail.
      const pkgUpdateUrl = (require('../package.json')?.build?.publish?.[0]?.url as string) || '';
      const envUpdateUrl = process.env.LOOM_UPDATE_URL?.trim() || '';
      const updateUrlIsPlaceholder =
        !envUpdateUrl &&
        (pkgUpdateUrl.includes('updates.loom-ide.example') || pkgUpdateUrl.includes('localhost') || !pkgUpdateUrl);
      if (envUpdateUrl) {
        autoUpdater.setFeedURL({ provider: 'generic', url: envUpdateUrl });
        console.log(`[AutoUpdater] using LOOM_UPDATE_URL feed: ${envUpdateUrl}`);
      }
      if (updateUrlIsPlaceholder) {
        console.warn('[AutoUpdater] no update feed configured (set LOOM_UPDATE_URL or build.publish.url) — skipping startup check.');
      } else {
        autoUpdater.checkForUpdates();
      }
      // 手动「检查更新」（Help 菜单）：占位 URL 时返回未配置，避免静默无响应。
      ipcMain.handle('update:check', async () => {
        if (updateUrlIsPlaceholder) {
          return { ok: false, reason: 'not-configured' };
        }
        try {
          const result = await autoUpdater.checkForUpdates();
          return { ok: true, current: autoUpdater.currentVersion?.version || '', hasUpdate: !!result?.updateInfo };
        } catch (e: any) {
          return { ok: false, reason: 'error', message: e?.message || 'update check failed' };
        }
      });
    } catch (e) {
      console.warn('Auto updater init failed (non-critical):', e);
    }
  } catch (e) {
    console.error('App init failed:', e);
    if (!mainWindow) {
      createWindow();
      trace('after-createWindow-fallback');
    }
  }

  // ---- System tray (non-critical) ----
  try {
    const iconPath = path.join(__dirname, '../../resources/icon.ico');
    if (fs.existsSync(iconPath)) {
      const trayIcon = nativeImage.createFromPath(iconPath);
      if (!trayIcon.isEmpty()) {
        tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
        tray.setToolTip('Loom IDE');
        const contextMenu = Menu.buildFromTemplate([
          { label: '显示 Loom IDE', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
          { label: '退出', click: () => { app.quit(); } },
        ]);
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isVisible()) mainWindow.focus();
            else { mainWindow.show(); mainWindow.focus(); }
          }
        });
      }
    }
  } catch (e) {
    console.warn('Tray creation failed (non-critical):', e);
  }
});

// ---- Global error capture ----
process.on('uncaughtException', (error) => {
  telemetry.captureException(error, { source: 'uncaughtException' });
});
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error) telemetry.captureException(reason, { source: 'unhandledRejection' });
});

// ---- Cleanup on quit ----
app.on('window-all-closed', () => {
  trace('window-all-closed');
  stopFileWatcher();
  killAllTerminals();
  killDebugger();
  abortAllStreams();
  killAllRuns();
  stopHistoryCleanupTimer();
  if (tray) { try { tray.destroy(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

trace('module-load-end');
