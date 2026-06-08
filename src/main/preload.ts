import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('loom', {
  agent: {
    chat: (messages: any[], context?: string) => ipcRenderer.invoke('agent:chat', messages, context),
    chatStream: (messages: any[], context: string | undefined, onChunk: (chunk: string) => void, onEnd: () => void, onError: (err: any) => void) => {
      const id = Math.random().toString(36).substring(7);
      const chunkListener = (_e: any, rid: string, chunk: string) => { if (rid === id) onChunk(chunk); };
      const endListener = (_e: any, rid: string) => { if (rid === id) { onEnd(); cleanup(); } };
      const errorListener = (_e: any, rid: string, error: string) => { if (rid === id) { onError(new Error(error)); cleanup(); } };
      const cleanup = () => {
        ipcRenderer.removeListener('agent:chat-stream-chunk', chunkListener);
        ipcRenderer.removeListener('agent:chat-stream-end', endListener);
        ipcRenderer.removeListener('agent:chat-stream-error', errorListener);
      };
      ipcRenderer.on('agent:chat-stream-chunk', chunkListener);
      ipcRenderer.on('agent:chat-stream-end', endListener);
      ipcRenderer.on('agent:chat-stream-error', errorListener);
      ipcRenderer.send('agent:chat-stream', id, messages, context);
      return () => { ipcRenderer.send('agent:chat-stream-abort', id); cleanup(); };
    },
    listSkills: () => ipcRenderer.invoke('agent:list-skills'),
    getSkill: (id: string) => ipcRenderer.invoke('agent:get-skill', id),
    status: () => ipcRenderer.invoke('agent:status'),
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    setAll: (cfg: any) => ipcRenderer.invoke('settings:setAll', cfg),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:open-file'),
    openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
    saveFile: (p: string) => ipcRenderer.invoke('dialog:save-file', p),
  },
  fs: {
    readFile: (p: string) => ipcRenderer.invoke('fs:read-file', p),
    writeFile: (p: string, c: string) => ipcRenderer.invoke('fs:write-file', p, c),
    readDir: (p: string) => ipcRenderer.invoke('fs:read-dir', p),
    stat: (p: string) => ipcRenderer.invoke('fs:stat', p),
    exists: (p: string) => ipcRenderer.invoke('fs:exists', p),
    mkdir: (p: string) => ipcRenderer.invoke('fs:mkdir', p),
    deletePath: (p: string) => ipcRenderer.invoke('fs:delete', p),
    rename: (o: string, n: string) => ipcRenderer.invoke('fs:rename', o, n),
  },
  git: {
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    stage: (cwd: string, file: string) => ipcRenderer.invoke('git:stage', cwd, file),
    unstage: (cwd: string, file: string) => ipcRenderer.invoke('git:unstage', cwd, file),
    commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
    pull: (cwd: string) => ipcRenderer.invoke('git:pull', cwd),
    push: (cwd: string) => ipcRenderer.invoke('git:push', cwd),
    checkout: (cwd: string, branch: string) => ipcRenderer.invoke('git:checkout', cwd, branch),
    log: (cwd: string, count?: number) => ipcRenderer.invoke('git:log', cwd, count),
    diff: (cwd: string, file?: string) => ipcRenderer.invoke('git:diff', cwd, file),
  },
  terminal: {
    create: (id: string) => ipcRenderer.invoke('terminal:create', id),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('terminal:kill', id),
    onData: (id: string, callback: (data: string) => void) => {
      const listener = (_e: any, tid: string, data: string) => { if (tid === id) callback(data); };
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (id: string, callback: (code: number | null) => void) => {
      const listener = (_e: any, tid: string, code: number | null) => { if (tid === id) callback(code); };
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb: (maximized: boolean) => void) => {
      const listener = (_e: any, m: boolean) => cb(m);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },
  debug: {
    start: (scriptPath: string, cwd: string) => ipcRenderer.invoke('debug:start', scriptPath, cwd),
    stop: () => ipcRenderer.invoke('debug:stop'),
    onStdout: (cb: (data: string) => void) => {
      const listener = (_e: any, data: string) => cb(data);
      ipcRenderer.on('debug:stdout', listener);
      return () => ipcRenderer.removeListener('debug:stdout', listener);
    },
    onStderr: (cb: (data: string) => void) => {
      const listener = (_e: any, data: string) => cb(data);
      ipcRenderer.on('debug:stderr', listener);
      return () => ipcRenderer.removeListener('debug:stderr', listener);
    },
    onExit: (cb: (code: number | null) => void) => {
      const listener = (_e: any, code: number | null) => cb(code);
      ipcRenderer.on('debug:exit', listener);
      return () => ipcRenderer.removeListener('debug:exit', listener);
    },
  },
});
