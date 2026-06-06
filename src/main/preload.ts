import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('loom', {
  agent: {
    chat: (message: string, context?: string) => ipcRenderer.invoke('agent:chat', message, context),
    chatStream: (message: string, context?: string) => ipcRenderer.invoke('agent:chat-stream', message, context),
    listSkills: () => ipcRenderer.invoke('agent:list-skills'),
    getSkill: (id: string) => ipcRenderer.invoke('agent:get-skill', id),
    status: () => ipcRenderer.invoke('agent:status'),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:open-file'),
    openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  },
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
    readDir: (path: string) => ipcRenderer.invoke('fs:read-dir', path),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },
});
