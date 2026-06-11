import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import type { IPty } from 'node-pty';
import { AIEngine, AIConfig, ChatMessage, AIProvider, AgentProfile } from '../agent/ai-engine';
import { PluginManager, PluginManifest } from './plugin-manager';
import { SkillManager } from '../agent/skills';
import { MCPClient, MCPServerConfig } from '../agent/mcp-client';

let ptySpawn: any = null;
function getPty() {
  if (!ptySpawn) {
    try { ptySpawn = require('node-pty').spawn; } catch { return null; }
  }
  return ptySpawn;
}

let mainWindow: BrowserWindow | null = null;
let aiEngine: AIEngine | null = null;
let pluginManager: PluginManager | null = null;
let skillManager: SkillManager | null = null;
let mcpClient: MCPClient | null = null;

// ====== Config / Settings ======
const userData = app.getPath('userData');
const dataDir = path.join(userData, 'data');
const configPath = path.join(dataDir, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function loadConfig(): any {
  ensureDataDir();
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      aiConfig: null as AIConfig | null,
      theme: 'dark',
      editor: {
        fontSize: 14, fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        tabSize: 2, wordWrap: 'off', minimap: true, lineNumbers: true,
        cursorBlinking: 'blink', smoothScrolling: true, formatOnSave: false, autoSave: 'off',
      },
      recentFolders: [] as string[],
      windowState: { width: 1400, height: 900, x: undefined as number | undefined, y: undefined as number | undefined, maximized: false },
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
  catch { return {}; }
}

function saveConfig(config: any) {
  ensureDataDir();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function initAIEngine() {
  const cfg = loadConfig();
  aiEngine = new AIEngine(cfg.aiConfig || undefined);
  aiEngine.onUpdateConfig((newAiCfg) => {
    const fullCfg = loadConfig();
    fullCfg.aiConfig = newAiCfg;
    saveConfig(fullCfg);
  });
}

function initPluginManager() {
  pluginManager = new PluginManager();
}

function initSkillManager() {
  skillManager = new SkillManager();
}

function initMCPClient() {
  const cfg = loadConfig();
  mcpClient = new MCPClient(cfg.mcpServers || undefined);
  mcpClient.onUpdateConfig((servers) => {
    const fullCfg = loadConfig();
    fullCfg.mcpServers = servers;
    saveConfig(fullCfg);
  });
  // Auto-connect to enabled MCP servers
  setTimeout(() => mcpClient?.reconnectAll(), 1000);
}

// ====== Static File Server ======
let staticServer: http.Server | null = null;
const STATIC_PORT = 5174;

function startStaticServer(): Promise<void> {
  return new Promise((resolve) => {
    const ROOT = path.join(__dirname, '../renderer');
    const MIME: Record<string, string> = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff',
      '.woff2': 'font/woff2', '.ico': 'image/x-icon',
    };
    staticServer = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : (req.url || '/').split('?')[0]);
      if (!fs.existsSync(filePath)) filePath = path.join(ROOT, 'index.html');
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    staticServer.listen(STATIC_PORT, () => {
      console.log(`[Loom Static Server] http://localhost:${STATIC_PORT}`);
      resolve();
    });
  });
}

// ====== Window ======
function createWindow() {
  const cfg = loadConfig();
  const theme = cfg.theme || 'dark';
  const ws = cfg.windowState || {};

  mainWindow = new BrowserWindow({
    width: ws.width || 1400, height: ws.height || 900,
    x: ws.x, y: ws.y,
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
    },
  });

  if (ws.maximized) mainWindow.maximize();

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('http://localhost:5174');
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
    mainWindow!.focus();
    mainWindow!.webContents.openDevTools();
  });

  // Also show after a short delay as fallback
  setTimeout(() => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  }, 2000);

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));

  // Save window state on close
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const isMax = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    const cfg = loadConfig();
    cfg.windowState = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, maximized: isMax };
    saveConfig(cfg);
  });
}

// ====== AI Agent Streaming ======
const activeStreams = new Map<string, { abort: boolean }>();

ipcMain.handle('ai:chat', async (_event: any, messages: ChatMessage[], context?: string) => {
  if (!aiEngine) initAIEngine();
  return aiEngine!.chat(messages, context);
});

ipcMain.on('ai:chat-stream', (event: any, id: string, messages: ChatMessage[], context?: string) => {
  if (!aiEngine) initAIEngine();
  const streamState = { abort: false };
  activeStreams.set(id, streamState);
  (async () => {
    try {
      const generator = aiEngine!.chatStream(messages, context);
      for await (const chunk of generator) {
        if (streamState.abort) break;
        event.sender.send('ai:chat-stream-chunk', id, chunk);
      }
      event.sender.send('ai:chat-stream-end', id);
    } catch (e: any) {
      event.sender.send('ai:chat-stream-error', id, e.message || 'Unknown error');
    } finally {
      activeStreams.delete(id);
    }
  })();
});

ipcMain.on('ai:chat-stream-abort', (_event: any, id: string) => {
  const s = activeStreams.get(id);
  if (s) s.abort = true;
});

// ====== Agent Mode Chat (with tool calling) ======
ipcMain.on('ai:agent-chat-stream', (event: any, id: string, messages: any[], workspacePath: string, openFiles?: any[]) => {
  if (!aiEngine) initAIEngine();
  const streamState = { abort: false };
  activeStreams.set(id, streamState);
  (async () => {
    try {
      const generator = aiEngine!.agentChatStream(messages, {
        workspacePath,
        openFiles: openFiles || [],
        diagnostics: [],
        onFileCreated: (filePath, content) => {
          event.sender.send('ai:agent-file-created', id, filePath, content);
        },
        onFileChanged: (filePath, content) => {
          event.sender.send('ai:agent-file-changed', id, filePath, content);
        },
      }, 15);
      
      for await (const chunk of generator) {
        if (streamState.abort) break;
        event.sender.send('ai:agent-chat-chunk', id, chunk);
      }
      event.sender.send('ai:agent-chat-end', id);
    } catch (e: any) {
      event.sender.send('ai:agent-chat-error', id, e.message || 'Unknown error');
    } finally {
      activeStreams.delete(id);
    }
  })();
});

ipcMain.handle('ai:getConfig', () => {
  if (!aiEngine) initAIEngine();
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:updateConfig', (_e: any, patch: Partial<AIConfig>) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.updateConfig(patch);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:updateProvider', (_e: any, id: string, patch: Partial<AIProvider>) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.updateProvider(id, patch);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:addProvider', (_e: any, provider: AIProvider) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.addProvider(provider);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:removeProvider', (_e: any, id: string) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.removeProvider(id);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:updateProfile', (_e: any, id: string, patch: Partial<AgentProfile>) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.updateProfile(id, patch);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:addProfile', (_e: any, profile: AgentProfile) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.addProfile(profile);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:removeProfile', (_e: any, id: string) => {
  if (!aiEngine) initAIEngine();
  aiEngine!.removeProfile(id);
  return aiEngine!.getConfig();
});

ipcMain.handle('ai:testConnection', async (_e: any, providerId: string) => {
  if (!aiEngine) initAIEngine();
  return aiEngine!.testConnection(providerId);
});

ipcMain.handle('ai:checkOrcaStatus', async () => {
  if (!aiEngine) initAIEngine();
  return aiEngine!.checkOrcaStatus();
});

ipcMain.handle('ai:getOrcaProviders', async () => {
  if (!aiEngine) initAIEngine();
  return aiEngine!.getOrcaProviders();
});

// ====== File Index (for Quick Open) with mtime cache ======
let fileIndex: string[] = [];
let fileIndexCwd = '';
let fileIndexMtime = 0;
let fileIndexBuildTime = 0;

function getDirMtime(cwd: string): number {
  try { return fs.statSync(cwd).mtimeMs; } catch { return 0; }
}

async function buildFileIndex(cwd: string): Promise<string[]> {
  const result: string[] = [];
  const hidden = new Set(['node_modules', '.git', 'dist', 'release', '__pycache__', '.next', 'coverage', '.vscode', '.workbuddy']);
  async function walk(dir: string, depth: number) {
    if (depth > 8 || result.length > 10000) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (hidden.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else result.push(full);
      }
    } catch {}
  }
  await walk(cwd, 0);
  return result;
}

ipcMain.handle('fs:index-files', async (_e: any, cwd: string) => {
  const now = Date.now();
  const dirMtime = getDirMtime(cwd);
  if (fileIndexCwd === cwd && fileIndex.length > 0 && 
      fileIndexMtime === dirMtime && (now - fileIndexBuildTime) < 30000) {
    return fileIndex;
  }
  fileIndex = await buildFileIndex(cwd);
  fileIndexCwd = cwd;
  fileIndexMtime = dirMtime;
  fileIndexBuildTime = now;
  return fileIndex;
});

ipcMain.handle('fs:search-files', async (_e: any, cwd: string, query: string) => {
  const now = Date.now();
  const dirMtime = getDirMtime(cwd);
  if (fileIndexCwd !== cwd || fileIndex.length === 0 ||
      fileIndexMtime !== dirMtime || (now - fileIndexBuildTime) >= 30000) {
    fileIndex = await buildFileIndex(cwd);
    fileIndexCwd = cwd;
    fileIndexMtime = dirMtime;
    fileIndexBuildTime = now;
  }
  const q = query.toLowerCase();
  const scored = fileIndex.map(fp => {
    const name = fp.split(/[\\/]/).pop()?.toLowerCase() || '';
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else {
      let qi = 0;
      for (let i = 0; i < name.length && qi < q.length; i++) {
        if (name[i] === q[qi]) qi++;
      }
      if (qi === q.length) score = 40;
      else return null;
    }
    return { path: fp, score };
  }).filter(Boolean).sort((a, b) => (b as any).score - (a as any).score).slice(0, 50);
  return scored.map((s: any) => s.path);
});

// ====== Plugin System ======
ipcMain.handle('plugins:getAll', () => {
  if (!pluginManager) initPluginManager();
  return pluginManager!.getAllPlugins().map(p => ({
    id: p.id,
    manifest: p.manifest,
    enabled: p.enabled,
    builtin: p.builtin,
    path: p.path,
  }));
});

ipcMain.handle('plugins:setEnabled', (_e: any, id: string, enabled: boolean) => {
  if (!pluginManager) initPluginManager();
  return pluginManager!.setEnabled(id, enabled);
});

ipcMain.handle('plugins:install', (_e: any, pluginPath: string) => {
  if (!pluginManager) initPluginManager();
  return pluginManager!.installPlugin(pluginPath);
});

ipcMain.handle('plugins:uninstall', (_e: any, id: string) => {
  if (!pluginManager) initPluginManager();
  return pluginManager!.uninstallPlugin(id);
});

ipcMain.handle('plugins:getCommands', () => {
  if (!pluginManager) initPluginManager();
  return pluginManager!.getAllCommands();
});

ipcMain.handle('plugins:installFromFile', async () => {
  if (!mainWindow) return { ok: false, msg: 'No window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Plugin Folder',
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, msg: 'Cancelled' };
  if (!pluginManager) initPluginManager();
  return pluginManager!.installPlugin(result.filePaths[0]);
});

// ====== Skills IPC ======
ipcMain.handle('skills:getAll', () => {
  if (!skillManager) initSkillManager();
  return skillManager!.getAll();
});

ipcMain.handle('skills:getByCategory', (_e: any, category: string) => {
  if (!skillManager) initSkillManager();
  return skillManager!.getByCategory(category as any);
});

ipcMain.handle('skills:resolvePrompt', (_e: any, skillId: string, variables: Record<string, string>) => {
  if (!skillManager) initSkillManager();
  return skillManager!.resolvePrompt(skillId, variables);
});

// ====== MCP IPC ======
ipcMain.handle('mcp:getServers', () => {
  if (!mcpClient) initMCPClient();
  return mcpClient!.getAllServers();
});

ipcMain.handle('mcp:addServer', (_e: any, config: MCPServerConfig) => {
  if (!mcpClient) initMCPClient();
  mcpClient!.addServer(config);
  return true;
});

ipcMain.handle('mcp:updateServer', (_e: any, id: string, patch: Partial<MCPServerConfig>) => {
  if (!mcpClient) initMCPClient();
  mcpClient!.updateServer(id, patch);
  return true;
});

ipcMain.handle('mcp:removeServer', (_e: any, id: string) => {
  if (!mcpClient) initMCPClient();
  mcpClient!.removeServer(id);
  return true;
});

ipcMain.handle('mcp:connect', async (_e: any, serverId: string) => {
  if (!mcpClient) initMCPClient();
  return mcpClient!.connect(serverId);
});

ipcMain.handle('mcp:disconnect', (_e: any, serverId: string) => {
  if (!mcpClient) initMCPClient();
  mcpClient!.disconnect(serverId);
  return true;
});

ipcMain.handle('mcp:getTools', () => {
  if (!mcpClient) initMCPClient();
  return mcpClient!.getAllTools();
});

ipcMain.handle('mcp:callTool', async (_e: any, serverId: string, toolName: string, args: Record<string, any>) => {
  if (!mcpClient) initMCPClient();
  try {
    const result = await mcpClient!.callTool(serverId, toolName, args);
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
});

// ====== Settings IPC ======
ipcMain.handle('settings:getAll', () => loadConfig());
ipcMain.handle('settings:set', (_e: any, key: string, value: any) => {
  const cfg = loadConfig();
  // Support nested keys like 'editor.fontSize'
  const keys = key.split('.');
  let target: any = cfg;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]]) target[keys[i]] = {};
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
  saveConfig(cfg);
});
ipcMain.handle('settings:setAll', (_e: any, newCfg: any) => {
  saveConfig(newCfg);
});

// ====== File Dialogs ======
ipcMain.handle('dialog:open-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled) return null;
  const files: { path: string; content: string }[] = [];
  for (const fp of result.filePaths) {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      files.push({ path: fp, content });
    } catch {}
  }
  return files;
});

ipcMain.handle('dialog:open-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  const folder = result.filePaths[0];
  // Add to recent folders
  const cfg = loadConfig();
  const recent: string[] = cfg.recentFolders || [];
  const filtered = recent.filter(r => r !== folder);
  cfg.recentFolders = [folder, ...filtered].slice(0, 10);
  saveConfig(cfg);
  return folder;
});

ipcMain.handle('dialog:save-file', async (_e: any, filePath: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: filePath });
  if (result.canceled) return null;
  return result.filePath;
});

// ====== Recent Folders ======
ipcMain.handle('recent:getFolders', () => {
  const cfg = loadConfig();
  return cfg.recentFolders || [];
});

ipcMain.handle('recent:clearFolders', () => {
  const cfg = loadConfig();
  cfg.recentFolders = [];
  saveConfig(cfg);
});

// ====== Conversation History ======
const conversationsDir = path.join(dataDir, 'conversations');
function ensureConversationsDir() {
  if (!fs.existsSync(conversationsDir)) {
    fs.mkdirSync(conversationsDir, { recursive: true });
  }
}

ipcMain.handle('conversations:save', (_e: any, projectPath: string, messages: any[]) => {
  try {
    ensureConversationsDir();
    const hash = Buffer.from(projectPath).toString('base64').replace(/[/+=]/g, '_');
    const filePath = path.join(conversationsDir, `${hash}.json`);
    const data = {
      projectPath,
      updatedAt: new Date().toISOString(),
      messages: messages.slice(-500), // Keep last 500 messages
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
});

ipcMain.handle('conversations:load', (_e: any, projectPath: string) => {
  try {
    ensureConversationsDir();
    const hash = Buffer.from(projectPath).toString('base64').replace(/[/+=]/g, '_');
    const filePath = path.join(conversationsDir, `${hash}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.messages || [];
    }
    return [];
  } catch { return []; }
});

ipcMain.handle('conversations:list', () => {
  try {
    ensureConversationsDir();
    const files = fs.readdirSync(conversationsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fp = path.join(conversationsDir, f);
        const stat = fs.statSync(fp);
        return { name: f, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files;
  } catch { return []; }
});

ipcMain.handle('conversations:delete', (_e: any, projectPath: string) => {
  try {
    ensureConversationsDir();
    const hash = Buffer.from(projectPath).toString('base64').replace(/[/+=]/g, '_');
    const filePath = path.join(conversationsDir, `${hash}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch { return false; }
});

ipcMain.handle('conversations:clear', () => {
  try {
    ensureConversationsDir();
    const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
    for (const f of files) fs.unlinkSync(path.join(conversationsDir, f));
    return true;
  } catch { return false; }
});

// ====== File System ======
ipcMain.handle('fs:read-file', async (_e: any, filePath: string) => fs.readFileSync(filePath, 'utf-8'));
ipcMain.handle('fs:write-file', async (_e: any, filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});
ipcMain.handle('fs:read-dir', async (_e: any, dirPath: string) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name, isDirectory: e.isDirectory(), path: path.join(dirPath, e.name),
  }));
});
ipcMain.handle('fs:stat', async (_e: any, filePath: string) => {
  const stat = fs.statSync(filePath);
  return { isDirectory: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs };
});
ipcMain.handle('fs:exists', async (_e: any, filePath: string) => fs.existsSync(filePath));
ipcMain.handle('fs:mkdir', async (_e: any, dirPath: string) => { fs.mkdirSync(dirPath, { recursive: true }); return true; });
ipcMain.handle('fs:delete', async (_e: any, targetPath: string) => {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true });
  else fs.unlinkSync(targetPath);
  return true;
});
ipcMain.handle('fs:rename', async (_e: any, oldPath: string, newPath: string) => {
  fs.renameSync(oldPath, newPath);
  return true;
});

// ====== File Watcher ======
let fileWatcher: fs.FSWatcher | null = null;
let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const watchedPaths = new Set<string>();

ipcMain.handle('watcher:start', (_e: any, cwd: string) => {
  stopFileWatcher();
  try {
    fileWatcher = fs.watch(cwd, { recursive: true }, (_eventType: string, filename: string | null) => {
      if (!filename || !mainWindow || watchedPaths.has(filename)) return;
      watchedPaths.add(filename);
      // Debounce: collect changes over 300ms, then emit
      if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
      watchDebounceTimer = setTimeout(() => {
        const allChanged = [...watchedPaths];
        watchedPaths.clear();
        mainWindow?.webContents.send('watcher:change', cwd, allChanged);
      }, 300);
    });
    fileWatcher.on('error', (err: Error) => {
      console.error('File watcher error:', err);
    });
    return true;
  } catch (e: any) {
    console.error('Failed to start file watcher:', e);
    return false;
  }
});

function stopFileWatcher() {
  if (fileWatcher) {
    try { fileWatcher.close(); } catch {}
    fileWatcher = null;
  }
  if (watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = null;
  }
  watchedPaths.clear();
}

ipcMain.handle('watcher:stop', () => {
  stopFileWatcher();
  return true;
});

// ====== Git ======
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else resolve(stderr.trim() || `git exited with code ${code}`);
    });
    child.on('error', (err) => reject(err));
  });
}

ipcMain.handle('git:status', async (_e: any, cwd: string) => {
  try {
    const branch = await runGit(cwd, ['branch', '--show-current']);
    const branches = (await runGit(cwd, ['branch', '--list'])).split('\n').map(b => b.replace(/^\*?\s*/, '').trim()).filter(Boolean);
    const statusOutput = await runGit(cwd, ['status', '--porcelain']);
    const changes = statusOutput.split('\n').filter(Boolean).map(line => {
      const status = line.charAt(0);
      const file = line.substring(3).trim();
      return { status, file };
    });
    return { branch, branches, changes };
  } catch {
    return { branch: '', branches: [], changes: [] };
  }
});

ipcMain.handle('git:stage', async (_e: any, cwd: string, file: string) => {
  try { await runGit(cwd, ['add', file]); return true; } catch { return false; }
});

ipcMain.handle('git:unstage', async (_e: any, cwd: string, file: string) => {
  try { await runGit(cwd, ['reset', 'HEAD', '--', file]); return true; } catch { return false; }
});

ipcMain.handle('git:commit', async (_e: any, cwd: string, message: string) => {
  try { await runGit(cwd, ['commit', '-m', message]); return true; } catch { return false; }
});

ipcMain.handle('git:pull', async (_e: any, cwd: string) => {
  try { return await runGit(cwd, ['pull']); } catch (e: any) { return `Error: ${e.message}`; }
});

ipcMain.handle('git:push', async (_e: any, cwd: string) => {
  try { return await runGit(cwd, ['push']); } catch (e: any) { return `Error: ${e.message}`; }
});

ipcMain.handle('git:checkout', async (_e: any, cwd: string, branch: string) => {
  try { await runGit(cwd, ['checkout', branch]); return true; } catch { return false; }
});

ipcMain.handle('git:log', async (_e: any, cwd: string, count: number = 20) => {
  try {
    const output = await runGit(cwd, ['log', `-${count}`, '--oneline', '--decorate', '--graph']);
    return output.split('\n').filter(Boolean);
  } catch { return []; }
});

ipcMain.handle('git:diff', async (_e: any, cwd: string, file?: string) => {
  try {
    const args = ['diff'];
    if (file) args.push('--', file);
    return await runGit(cwd, args);
  } catch { return ''; }
});

// ====== Shell ======
ipcMain.handle('shell:open-external', async (_e: any, url: string) => shell.openExternal(url));

// ====== Window Controls ======
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// ====== Terminal ======
const terminals = new Map<string, { process: any; id: string; isPty: boolean }>();

ipcMain.handle('terminal:create', async (event: any, termId: string) => {
  const ptyFn = getPty();
  const shellCmd = process.env.ComSpec || 'powershell.exe';
  const cwd = process.env.USERPROFILE || process.env.HOME || '';

  if (ptyFn) {
    // Use node-pty for full terminal capabilities including resize
    try {
      const ptyProcess = ptyFn(shellCmd, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env as { [key: string]: string },
      });
      terminals.set(termId, { process: ptyProcess, id: termId, isPty: true });
      ptyProcess.onData((data: string) => {
        event.sender.send('terminal:data', termId, data);
      });
      ptyProcess.onExit((code: { exitCode: number }) => {
        event.sender.send('terminal:exit', termId, code.exitCode);
        terminals.delete(termId);
      });
      return true;
    } catch (e) {
      console.error('PTY creation failed, falling back to spawn:', e);
    }
  }

  // Fallback to child_process spawn
  const isPowerShell = shellCmd.toLowerCase().includes('powershell');
  const args = isPowerShell ? ['-NoLogo'] : [];
  const child = spawn(shellCmd, args, {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  terminals.set(termId, { process: child, id: termId, isPty: false });
  child.stdout?.on('data', (data: Buffer) => { event.sender.send('terminal:data', termId, data.toString('utf-8')); });
  child.stderr?.on('data', (data: Buffer) => { event.sender.send('terminal:data', termId, data.toString('utf-8')); });
  child.on('exit', (code: number | null) => { event.sender.send('terminal:exit', termId, code); terminals.delete(termId); });
  return true;
});

ipcMain.on('terminal:write', (_e: any, termId: string, data: string) => {
  const t = terminals.get(termId);
  if (!t) return;
  if (t.isPty) {
    t.process.write(data);
  } else {
    t.process.stdin?.write(data);
  }
});

ipcMain.on('terminal:resize', (_e: any, termId: string, cols: number, rows: number) => {
  const t = terminals.get(termId);
  if (t && t.isPty) {
    try { t.process.resize(cols, rows); } catch (e) { console.error('Terminal resize error:', e); }
  }
});

ipcMain.on('terminal:kill', (_e: any, termId: string) => {
  const t = terminals.get(termId);
  if (!t) return;
  try { t.process.kill(); } catch (e) { console.error('Terminal kill error:', e); }
  terminals.delete(termId);
});

// ====== App lifecycle ======
let tray: Tray | null = null;

app.whenReady().then(async () => {
  ensureDataDir();
  initAIEngine();
  initPluginManager();
  await startStaticServer();
  createWindow();

  // System Tray
  const iconPath = path.join(__dirname, '../../resources/icon.ico');
  const trayIcon = nativeImage.createFromPath(iconPath);
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
});

// ====== Debugger ======
let debugProcess: ChildProcess | null = null;

function getDebugCommand(scriptPath: string, cwd: string): { cmd: string; args: string[]; port?: number } {
  const ext = path.extname(scriptPath).toLowerCase();
  const langMap: Record<string, { cmd: string; argsFn: (p: string) => string[]; port?: number }> = {
    '.js':   { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 },
    '.mjs':  { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 },
    '.cjs':  { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 },
    '.ts':   { cmd: 'npx', argsFn: (p) => ['tsx', '--inspect-brk=9229', p], port: 9229 },
    '.tsx':  { cmd: 'npx', argsFn: (p) => ['tsx', '--inspect-brk=9229', p], port: 9229 },
    '.py':   { cmd: 'python', argsFn: (p) => ['-m', 'pdb', p], port: undefined },
    '.pyw':  { cmd: 'python', argsFn: (p) => ['-m', 'pdb', p], port: undefined },
    '.go':   { cmd: 'dlv', argsFn: (p) => ['debug', p, '--headless', '--listen=:2345', '--api-version=2'], port: 2345 },
    '.rs':   { cmd: 'rust-gdb', argsFn: (p) => {
      const bin = p.replace(/\.rs$/, process.platform === 'win32' ? '.exe' : '');
      return ['--args', bin];
    }, port: undefined },
    '.java': { cmd: 'jdb', argsFn: (p) => {
      const cls = path.basename(p, '.java');
      return ['-classpath', path.dirname(p), cls];
    }, port: undefined },
    '.cs':   { cmd: 'dotnet', argsFn: () => ['run', '--project', cwd], port: undefined },
    '.rb':   { cmd: 'ruby', argsFn: (p) => ['-rdebug', p], port: undefined },
  };
  const cfg = langMap[ext] || { cmd: 'node', argsFn: (p) => ['--inspect-brk=9229', p], port: 9229 };
  return { cmd: cfg.cmd, args: cfg.argsFn(scriptPath), port: cfg.port };
}

ipcMain.handle('debug:start', async (event: any, scriptPath: string, cwd: string) => {
  try {
    if (debugProcess) { debugProcess.kill(); debugProcess = null; }
    const { cmd, args, port } = getDebugCommand(scriptPath, cwd);
    debugProcess = spawn(cmd, args, {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    debugProcess.stdout?.on('data', (data: Buffer) => {
      event.sender.send('debug:stdout', data.toString('utf-8'));
    });
    debugProcess.stderr?.on('data', (data: Buffer) => {
      event.sender.send('debug:stderr', data.toString('utf-8'));
    });
    debugProcess.on('exit', (code) => {
      event.sender.send('debug:exit', code);
      debugProcess = null;
    });
    const portMsg = port ? ` on port ${port}` : '';
    const ext = path.extname(scriptPath).toUpperCase();
    return { ok: true, message: `Debugger started for ${ext} file${portMsg}` };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('debug:stop', async () => {
  try {
    if (debugProcess) { debugProcess.kill(); debugProcess = null; }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
});

app.on('window-all-closed', () => {
  stopFileWatcher();
  terminals.forEach((t) => { try { t.process.kill(); } catch {} });
  terminals.clear();
  if (debugProcess) { try { debugProcess.kill(); } catch {} }
  if (staticServer) { try { staticServer.close(); } catch {} }
  if (tray) { try { tray.destroy(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
