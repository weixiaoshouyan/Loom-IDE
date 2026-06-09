import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { OrcaAgent, ChatMessage } from '../agent/connector';

let mainWindow: BrowserWindow | null = null;
let orcaAgent: OrcaAgent | null = null;

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
      activeProviderId: 'deepseek',
      providerKeys: {},
      activeModel: {},
      customProvider: { name: '', baseUrl: '', apiKey: '', models: '' },
      orcaPort: 18080,
      theme: 'dark',
      editor: {
        fontSize: 14, fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        tabSize: 2, wordWrap: 'off', minimap: true, lineNumbers: true,
        cursorBlinking: 'blink', smoothScrolling: true, formatOnSave: false, autoSave: 'off',
      },
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

function getOrcaPort(): number {
  const cfg = loadConfig();
  return cfg.orcaPort || 18080;
}

function initAgent() {
  const port = getOrcaPort();
  orcaAgent = new OrcaAgent(`http://127.0.0.1:${port}`);
}

// ====== Window ======
function createWindow() {
  const cfg = loadConfig();
  const theme = cfg.theme || 'dark';

  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Loom IDE',
    icon: path.join(__dirname, '../../resources/icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: theme === 'dark' ? '#3c3c3c' : '#f3f3f3',
      symbolColor: theme === 'dark' ? '#cccccc' : '#333333',
      height: 30,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));
}

// ====== Agent streaming ======
const activeStreams = new Map<string, { abort: boolean }>();

ipcMain.handle('agent:chat', async (_event: any, messages: ChatMessage[], context?: string) => {
  if (!orcaAgent) initAgent();
  return orcaAgent!.chat(messages, context);
});

ipcMain.on('agent:chat-stream', (event: any, id: string, messages: ChatMessage[], context?: string) => {
  if (!orcaAgent) initAgent();
  const streamState = { abort: false };
  activeStreams.set(id, streamState);
  (async () => {
    try {
      const generator = orcaAgent!.chatStream(messages, context);
      for await (const chunk of generator) {
        if (streamState.abort) break;
        event.sender.send('agent:chat-stream-chunk', id, chunk);
      }
      event.sender.send('agent:chat-stream-end', id);
    } catch (e: any) {
      event.sender.send('agent:chat-stream-error', id, e.message || 'Unknown error');
    } finally {
      activeStreams.delete(id);
    }
  })();
});

ipcMain.on('agent:chat-stream-abort', (_event: any, id: string) => {
  const s = activeStreams.get(id);
  if (s) s.abort = true;
});

ipcMain.handle('agent:list-skills', async () => {
  if (!orcaAgent) initAgent();
  return orcaAgent!.listSkills();
});
ipcMain.handle('agent:get-skill', async (_e: any, id: string) => {
  if (!orcaAgent) initAgent();
  return orcaAgent!.getSkill(id);
});
ipcMain.handle('agent:status', async () => {
  if (!orcaAgent) initAgent();
  return orcaAgent!.getStatus();
});

// ====== Settings IPC ======
ipcMain.handle('settings:getAll', () => loadConfig());
ipcMain.handle('settings:set', (_e: any, key: string, value: any) => {
  const cfg = loadConfig();
  (cfg as any)[key] = value;
  saveConfig(cfg);
});
ipcMain.handle('settings:setAll', (_e: any, newCfg: any) => {
  saveConfig(newCfg);
});

// ====== File Dialogs ======
ipcMain.handle('dialog:open-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { path: filePath, content };
});

ipcMain.handle('dialog:open-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:save-file', async (_e: any, filePath: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: filePath });
  if (result.canceled) return null;
  return result.filePath;
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
const terminals = new Map<string, { process: ChildProcess; id: string }>();

ipcMain.handle('terminal:create', async (event: any, termId: string) => {
  const shellCmd = process.env.ComSpec || 'powershell.exe';
  const isPowerShell = shellCmd.toLowerCase().includes('powershell');
  const args = isPowerShell ? ['-NoLogo'] : [];
  const child = spawn(shellCmd, args, {
    cwd: process.env.USERPROFILE || process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  terminals.set(termId, { process: child, id: termId });
  child.stdout?.on('data', (data: Buffer) => { event.sender.send('terminal:data', termId, data.toString('utf-8')); });
  child.stderr?.on('data', (data: Buffer) => { event.sender.send('terminal:data', termId, data.toString('utf-8')); });
  child.on('exit', (code: number | null) => { event.sender.send('terminal:exit', termId, code); terminals.delete(termId); });
  return true;
});

ipcMain.on('terminal:write', (_e: any, termId: string, data: string) => {
  const t = terminals.get(termId);
  if (t) t.process.stdin?.write(data);
});

ipcMain.on('terminal:resize', (_e: any, termId: string, cols: number, rows: number) => {
  const t = terminals.get(termId);
  if (t && t.process.stdin) {
    // For node-pty, we would resize the PTY, but since we're using child_process,
    // we'll just note that resize is not fully supported
    // In a real implementation, you'd use node-pty's resize method
  }
});

ipcMain.on('terminal:kill', (_e: any, termId: string) => {
  const t = terminals.get(termId);
  if (t) { t.process.kill(); terminals.delete(termId); }
});

// ====== App lifecycle ======
app.whenReady().then(() => {
  ensureDataDir();
  initAgent();
  createWindow();
});

// ====== Debugger ======
let debugProcess: ChildProcess | null = null;
let debugClient: any = null;

ipcMain.handle('debug:start', async (event: any, scriptPath: string, cwd: string) => {
  try {
    if (debugProcess) { debugProcess.kill(); debugProcess = null; }
    debugProcess = spawn('node', ['--inspect-brk=9229', scriptPath], {
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
    return { ok: true, message: `Debugger started on port 9229` };
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
  // Kill all terminal processes before quitting
  terminals.forEach((t) => { try { t.process.kill(); } catch {} });
  terminals.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
