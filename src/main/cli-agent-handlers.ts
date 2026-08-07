/**
 * CLI agent + agent-task IPC handlers.
 */
import { ipcMain } from 'electron';
import { listCliAgents, runCliAgent } from './cli-agents';
import { canAccess } from './path-permissions';

function getMainWindow(): any {
  // Lazy require to avoid cycles.
  return (global as any).__loom_mainWindow ?? null;
}

export function registerCliAgentHandlers() {
  ipcMain.handle('cli-agents:list', () => listCliAgents());

  ipcMain.handle('cli-agents:run', async (_e: any, agentId: string, prompt: string, cwd?: string) => {
    // SECURITY: never run a CLI agent inside an arbitrary attacker-chosen directory.
    if (cwd && !canAccess(cwd)) return { ok: false, stdout: '', stderr: 'Workspace path is not allowed.', exitCode: -1 };
    return runCliAgent(agentId, prompt, cwd);
  });

  // Agent task queue.
  ipcMain.handle('agent-tasks:list', () => {
    const q = (global as any).__loom_commandQueue;
    return q ? q.list() : [];
  });
  ipcMain.handle('agent-tasks:get', (_e: any, taskId: string) => {
    const q = (global as any).__loom_commandQueue;
    return q ? q.get(taskId) : null;
  });
  ipcMain.handle('agent-tasks:cancel', (_e: any, taskId: string) => {
    const q = (global as any).__loom_commandQueue;
    return q ? q.cancel(taskId) : false;
  });
  ipcMain.handle('agent-tasks:retry', (_e: any, taskId: string) => {
    const q = (global as any).__loom_commandQueue;
    const win = getMainWindow();
    if (!q) return false;
    return q.retry(taskId, (event: any) => {
      win?.webContents?.send('ai:agent-chat-chunk', '__agent-task-center__', {
        type: 'task_event',
        content: '',
        taskEvent: event,
      });
    }) !== null;
  });
}
