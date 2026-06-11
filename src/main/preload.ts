import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('loom', {
  ai: {
    chat: (messages: any[], context?: string) => ipcRenderer.invoke('ai:chat', messages, context),
    chatStream: (messages: any[], context: string | undefined, onChunk: (chunk: string) => void, onEnd: () => void, onError: (err: any) => void) => {
      const id = Math.random().toString(36).substring(7);
      const chunkListener = (_e: any, rid: string, chunk: string) => { if (rid === id) onChunk(chunk); };
      const endListener = (_e: any, rid: string) => { if (rid === id) { onEnd(); cleanup(); } };
      const errorListener = (_e: any, rid: string, error: string) => { if (rid === id) { onError(new Error(error)); cleanup(); } };
      const cleanup = () => {
        ipcRenderer.removeListener('ai:chat-stream-chunk', chunkListener);
        ipcRenderer.removeListener('ai:chat-stream-end', endListener);
        ipcRenderer.removeListener('ai:chat-stream-error', errorListener);
      };
      ipcRenderer.on('ai:chat-stream-chunk', chunkListener);
      ipcRenderer.on('ai:chat-stream-end', endListener);
      ipcRenderer.on('ai:chat-stream-error', errorListener);
      ipcRenderer.send('ai:chat-stream', id, messages, context);
      return () => { ipcRenderer.send('ai:chat-stream-abort', id); cleanup(); };
    },
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    updateConfig: (patch: any) => ipcRenderer.invoke('ai:updateConfig', patch),
    updateProvider: (id: string, patch: any) => ipcRenderer.invoke('ai:updateProvider', id, patch),
    addProvider: (provider: any) => ipcRenderer.invoke('ai:addProvider', provider),
    removeProvider: (id: string) => ipcRenderer.invoke('ai:removeProvider', id),
    updateProfile: (id: string, patch: any) => ipcRenderer.invoke('ai:updateProfile', id, patch),
    addProfile: (profile: any) => ipcRenderer.invoke('ai:addProfile', profile),
    removeProfile: (id: string) => ipcRenderer.invoke('ai:removeProfile', id),
    testConnection: (providerId: string) => ipcRenderer.invoke('ai:testConnection', providerId),
    checkOrcaStatus: () => ipcRenderer.invoke('ai:checkOrcaStatus'),
    getOrcaProviders: () => ipcRenderer.invoke('ai:getOrcaProviders'),
    // Agent mode with tool calling
    agentChatStream: (messages: any[], workspacePath: string, openFiles: any[] | undefined,
      onChunk: (chunk: any) => void, onEnd: () => void, onError: (err: any) => void,
      onFileCreated?: (filePath: string, content: string) => void,
      onFileChanged?: (filePath: string, content: string) => void) => {
      const id = Math.random().toString(36).substring(7);
      const chunkListener = (_e: any, rid: string, chunk: any) => { if (rid === id) onChunk(chunk); };
      const endListener = (_e: any, rid: string) => { if (rid === id) { onEnd(); cleanup(); } };
      const errorListener = (_e: any, rid: string, error: string) => { if (rid === id) { onError(new Error(error)); cleanup(); } };
      const fileCreatedListener = (_e: any, rid: string, filePath: string, content: string) => { if (rid === id && onFileCreated) onFileCreated(filePath, content); };
      const fileChangedListener = (_e: any, rid: string, filePath: string, content: string) => { if (rid === id && onFileChanged) onFileChanged(filePath, content); };
      const cleanup = () => {
        ipcRenderer.removeListener('ai:agent-chat-chunk', chunkListener);
        ipcRenderer.removeListener('ai:agent-chat-end', endListener);
        ipcRenderer.removeListener('ai:agent-chat-error', errorListener);
        ipcRenderer.removeListener('ai:agent-file-created', fileCreatedListener);
        ipcRenderer.removeListener('ai:agent-file-changed', fileChangedListener);
      };
      ipcRenderer.on('ai:agent-chat-chunk', chunkListener);
      ipcRenderer.on('ai:agent-chat-end', endListener);
      ipcRenderer.on('ai:agent-chat-error', errorListener);
      ipcRenderer.on('ai:agent-file-created', fileCreatedListener);
      ipcRenderer.on('ai:agent-file-changed', fileChangedListener);
      ipcRenderer.send('ai:agent-chat-stream', id, messages, workspacePath, openFiles);
      return () => { ipcRenderer.send('ai:chat-stream-abort', id); cleanup(); };
    },
  },
  plugins: {
    getAll: () => ipcRenderer.invoke('plugins:getAll'),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    install: (pluginPath: string) => ipcRenderer.invoke('plugins:install', pluginPath),
    uninstall: (id: string) => ipcRenderer.invoke('plugins:uninstall', id),
    getCommands: () => ipcRenderer.invoke('plugins:getCommands'),
    installFromFile: () => ipcRenderer.invoke('plugins:installFromFile'),
  },
  skills: {
    getAll: () => ipcRenderer.invoke('skills:getAll'),
    getByCategory: (category: string) => ipcRenderer.invoke('skills:getByCategory', category),
    resolvePrompt: (skillId: string, variables: Record<string, string>) =>
      ipcRenderer.invoke('skills:resolvePrompt', skillId, variables),
  },
  mcp: {
    getServers: () => ipcRenderer.invoke('mcp:getServers'),
    addServer: (config: any) => ipcRenderer.invoke('mcp:addServer', config),
    updateServer: (id: string, patch: any) => ipcRenderer.invoke('mcp:updateServer', id, patch),
    removeServer: (id: string) => ipcRenderer.invoke('mcp:removeServer', id),
    connect: (serverId: string) => ipcRenderer.invoke('mcp:connect', serverId),
    disconnect: (serverId: string) => ipcRenderer.invoke('mcp:disconnect', serverId),
    getTools: () => ipcRenderer.invoke('mcp:getTools'),
    callTool: (serverId: string, toolName: string, args: Record<string, any>) =>
      ipcRenderer.invoke('mcp:callTool', serverId, toolName, args),
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    setAll: (cfg: any) => ipcRenderer.invoke('settings:setAll', cfg),
  },
  recent: {
    getFolders: () => ipcRenderer.invoke('recent:getFolders'),
    clearFolders: () => ipcRenderer.invoke('recent:clearFolders'),
  },
  conversations: {
    save: (projectPath: string, messages: any[]) => ipcRenderer.invoke('conversations:save', projectPath, messages),
    load: (projectPath: string) => ipcRenderer.invoke('conversations:load', projectPath),
    list: () => ipcRenderer.invoke('conversations:list'),
    delete: (projectPath: string) => ipcRenderer.invoke('conversations:delete', projectPath),
    clear: () => ipcRenderer.invoke('conversations:clear'),
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
    indexFiles: (cwd: string) => ipcRenderer.invoke('fs:index-files', cwd),
    searchFiles: (cwd: string, query: string) => ipcRenderer.invoke('fs:search-files', cwd, query),
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
  watcher: {
    start: (cwd: string) => ipcRenderer.invoke('watcher:start', cwd),
    stop: () => ipcRenderer.invoke('watcher:stop'),
    onChange: (cb: (cwd: string, changedPaths: string[]) => void) => {
      const listener = (_e: any, cwd: string, changedPaths: string[]) => cb(cwd, changedPaths);
      ipcRenderer.on('watcher:change', listener);
      return () => ipcRenderer.removeListener('watcher:change', listener);
    },
  },
});
