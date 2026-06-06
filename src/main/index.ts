import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { OrcaAgent } from '../agent/connector';

let mainWindow: BrowserWindow | null = null;
const agent = new OrcaAgent('http://127.0.0.1:18080');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '织网 IDE',
    icon: path.join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e2e',
      symbolColor: '#cdd6f4',
      height: 38,
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
}

// IPC handlers for agent integration
ipcMain.handle('agent:chat', async (_event, message: string, context?: string) => {
  return agent.chat(message, context);
});

ipcMain.handle('agent:chat-stream', async (_event, message: string, context?: string) => {
  return agent.chatStream(message, context);
});

ipcMain.handle('agent:list-skills', async () => {
  return agent.listSkills();
});

ipcMain.handle('agent:get-skill', async (_event, skillId: string) => {
  return agent.getSkill(skillId);
});

ipcMain.handle('agent:status', async () => {
  return agent.getStatus();
});

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
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('fs:read-dir', async (_event, dirPath: string) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    path: path.join(dirPath, e.name),
  }));
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  shell.openExternal(url);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });
