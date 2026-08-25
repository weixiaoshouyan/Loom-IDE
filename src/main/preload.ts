import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type {
  Loom,
  LoomAgentStreamChunk,
  LoomUsage,
  LoomWebviewEvent,
} from '../renderer/loom-ipc';

// The exposed bridge is typed as `Loom`, the single source of truth shared with
// the renderer (src/renderer/loom-ipc.ts). `import type` is erased at build time
// so this adds no runtime coupling to renderer code, but it makes tsc prove that
// preload and the renderer contract stay mirror images of each other. Paired with
// ipc-contract.test.ts (channel-name parity), the IPC surface is guarded on both
// the type and the wire level.
const loom: Loom = {
  reportError: (payload) => {
    // Best-effort logging on the main process side. Use console for now so we
    // don't introduce file IO that could fail on locked-down systems.
    try { console.warn(`[renderer:${payload.type}] ${payload.ts} ${payload.msg}`); } catch {}
  },
  codeIndex: {
    search: (workspacePath, query, topK) => ipcRenderer.invoke('code-index:search', workspacePath, query, topK),
    prebuild: (workspacePath) => ipcRenderer.invoke('codeindex:prebuild', workspacePath),
    fileSymbols: (workspacePath, filePath) => ipcRenderer.invoke('code-index:file-symbols', workspacePath, filePath),
  },
  ai: {
    chatStream: (messages, context, onChunk, onEnd, onError, onUsage) => {
      const id = crypto.randomUUID();
      // 先移除同名旧监听器，避免多次注册累积
      const chunkEvent = 'ai:chat-stream-chunk';
      const endEvent = 'ai:chat-stream-end';
      const errorEvent = 'ai:chat-stream-error';
      const usageEvent = 'ai:chat-stream-usage';
      const chunkListener = (_e: IpcRendererEvent, rid: string, chunk: string) => { if (rid === id) onChunk(chunk); };
      const endListener = (_e: IpcRendererEvent, rid: string) => { if (rid === id) { onEnd(); cleanup(); } };
      const errorListener = (_e: IpcRendererEvent, rid: string, error: string) => { if (rid === id) { onError(new Error(error)); cleanup(); } };
      const usageListener = (_e: IpcRendererEvent, rid: string, usage: { input: number; output: number }) => {
        if (rid === id) onUsage?.(usage);
      };
      const cleanup = () => {
        ipcRenderer.removeListener(chunkEvent, chunkListener);
        ipcRenderer.removeListener(endEvent, endListener);
        ipcRenderer.removeListener(errorEvent, errorListener);
        ipcRenderer.removeListener(usageEvent, usageListener);
      };
      ipcRenderer.on(chunkEvent, chunkListener);
      ipcRenderer.on(endEvent, endListener);
      ipcRenderer.on(errorEvent, errorListener);
      ipcRenderer.on(usageEvent, usageListener);
      ipcRenderer.send('ai:chat-stream', id, messages, context);
      return () => { ipcRenderer.send('ai:chat-stream-abort', id); cleanup(); };
    },
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    updateConfig: (patch) => ipcRenderer.invoke('ai:updateConfig', patch),
    updateProvider: (id, patch) => ipcRenderer.invoke('ai:updateProvider', id, patch),
    addProvider: (provider) => ipcRenderer.invoke('ai:addProvider', provider),
    removeProvider: (id) => ipcRenderer.invoke('ai:removeProvider', id),
    updateProfile: (id, patch) => ipcRenderer.invoke('ai:updateProfile', id, patch),
    addProfile: (profile) => ipcRenderer.invoke('ai:addProfile', profile),
    removeProfile: (id) => ipcRenderer.invoke('ai:removeProfile', id),
    testConnection: (providerId) => ipcRenderer.invoke('ai:testConnection', providerId),
    listModels: (providerId) => ipcRenderer.invoke('ai:listModels', providerId),
    askWithStream: (providerId, model, messages, context, onChunk, onEnd, onError, onUsage) => {
      const id = crypto.randomUUID();
      const chunkEvent = 'ai:ask-with-stream-chunk';
      const endEvent = 'ai:ask-with-stream-end';
      const errorEvent = 'ai:ask-with-stream-error';
      const usageEvent = 'ai:ask-with-stream-usage';
      const chunkListener = (_e: IpcRendererEvent, rid: string, chunk: string) => { if (rid === id) onChunk(chunk); };
      const endListener = (_e: IpcRendererEvent, rid: string) => { if (rid === id) { onEnd(); cleanup(); } };
      const errorListener = (_e: IpcRendererEvent, rid: string, error: string) => { if (rid === id) { onError(new Error(error)); cleanup(); } };
      const usageListener = (_e: IpcRendererEvent, rid: string, usage: { input: number; output: number }) => {
        if (rid === id) onUsage?.(usage);
      };
      const cleanup = () => {
        ipcRenderer.removeListener(chunkEvent, chunkListener);
        ipcRenderer.removeListener(endEvent, endListener);
        ipcRenderer.removeListener(errorEvent, errorListener);
        ipcRenderer.removeListener(usageEvent, usageListener);
      };
      ipcRenderer.on(chunkEvent, chunkListener);
      ipcRenderer.on(endEvent, endListener);
      ipcRenderer.on(errorEvent, errorListener);
      ipcRenderer.on(usageEvent, usageListener);
      ipcRenderer.send('ai:ask-with-stream', id, providerId, model, messages, context);
      return () => { ipcRenderer.send('ai:ask-with-stream-abort', id); cleanup(); };
    },
    detectEnvProviders: () => ipcRenderer.invoke('ai:detectEnvProviders'),
    applyEnvProvider: (providerId) => ipcRenderer.invoke('ai:applyEnvProvider', providerId),
    checkOrcaStatus: () => ipcRenderer.invoke('ai:checkOrcaStatus'),
    approvePlan: (sid) => ipcRenderer.invoke('ai:agent-plan-approve', sid),
    rejectPlan: (sid) => ipcRenderer.invoke('ai:agent-plan-reject', sid),
    approveDestructive: (sid) => ipcRenderer.invoke('ai:agent-destructive-approve', sid),
    rejectDestructive: (sid) => ipcRenderer.invoke('ai:agent-destructive-reject', sid),
    rejectAgentEdit: (sid, filePath) => ipcRenderer.invoke('ai:agent-reject-edit', sid, filePath),
    checkpointList: (workspacePath) => ipcRenderer.invoke('ai:checkpoint-list', workspacePath),
    checkpointLoad: (workspacePath, checkpointId) => ipcRenderer.invoke('ai:checkpoint-load', workspacePath, checkpointId),
    checkpointDelete: (workspacePath, checkpointId) => ipcRenderer.invoke('ai:checkpoint-delete', workspacePath, checkpointId),
    agentChatStream: (messages, workspacePath, openFiles, onChunk, onEnd, onError,
      onFilePreview, onFileCreated, onFileChanged, onPlanAwait, onDestructiveAwait, options) => {
      const id = crypto.randomUUID();
      const chunkListener = (_e: IpcRendererEvent, rid: string, chunk: unknown) => { if (rid === id) onChunk(chunk as LoomAgentStreamChunk); };
      const endListener = (_e: IpcRendererEvent, rid: string, usage?: unknown) => { if (rid === id) { onEnd(usage as LoomUsage | null | undefined); cleanup(); } };
      const errorListener = (_e: IpcRendererEvent, rid: string, error: string) => { if (rid === id) { onError(new Error(error)); cleanup(); } };
      const filePreviewListener = (_e: IpcRendererEvent, rid: string, filePath: string, content: string, existed: boolean, originalContent: string) => {
        if (rid === id && onFilePreview) onFilePreview(filePath, content, existed, originalContent, id);
      };
      const fileCreatedListener = (_e: IpcRendererEvent, rid: string, filePath: string, content: string) => { if (rid === id && onFileCreated) onFileCreated(filePath, content); };
      const fileChangedListener = (_e: IpcRendererEvent, rid: string, filePath: string, content: string) => { if (rid === id && onFileChanged) onFileChanged(filePath, content); };
      const planAwaitListener = (_e: IpcRendererEvent, rid: string, planText: string) => { if (rid === id && onPlanAwait) onPlanAwait(planText, id); };
      const destructiveAwaitListener = (_e: IpcRendererEvent, rid: string, request: unknown) => {
        if (rid === id && onDestructiveAwait) onDestructiveAwait(request as { type: 'delete' | 'rename'; filePath: string; newPath?: string }, id);
      };
      const cleanup = () => {
        ipcRenderer.removeListener('ai:agent-chat-chunk', chunkListener);
        ipcRenderer.removeListener('ai:agent-chat-end', endListener);
        ipcRenderer.removeListener('ai:agent-chat-error', errorListener);
        ipcRenderer.removeListener('ai:agent-file-preview', filePreviewListener);
        ipcRenderer.removeListener('ai:agent-file-created', fileCreatedListener);
        ipcRenderer.removeListener('ai:agent-file-changed', fileChangedListener);
        ipcRenderer.removeListener('ai:agent-plan-await', planAwaitListener);
        ipcRenderer.removeListener('ai:agent-destructive-await', destructiveAwaitListener);
      };
      ipcRenderer.on('ai:agent-chat-chunk', chunkListener);
      ipcRenderer.on('ai:agent-chat-end', endListener);
      ipcRenderer.on('ai:agent-chat-error', errorListener);
      ipcRenderer.on('ai:agent-file-preview', filePreviewListener);
      ipcRenderer.on('ai:agent-file-created', fileCreatedListener);
      ipcRenderer.on('ai:agent-file-changed', fileChangedListener);
      ipcRenderer.on('ai:agent-plan-await', planAwaitListener);
      ipcRenderer.on('ai:agent-destructive-await', destructiveAwaitListener);
      ipcRenderer.send('ai:agent-chat-stream', id, messages, workspacePath, openFiles, options);
      return () => { ipcRenderer.send('ai:chat-stream-abort', id); cleanup(); };
    },
  },
  cliAgents: {
    list: () => ipcRenderer.invoke('cli-agents:list'),
    run: (agentId, prompt, cwd) => ipcRenderer.invoke('cli-agents:run', agentId, prompt, cwd),
  },
  agentTasks: {
    list: () => ipcRenderer.invoke('agent-tasks:list'),
    cancel: (taskId) => ipcRenderer.invoke('agent-tasks:cancel', taskId),
    retry: (taskId) => ipcRenderer.invoke('agent-tasks:retry', taskId),
  },
  plugins: {
    getAll: () => ipcRenderer.invoke('plugins:getAll'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
    getCommands: () => ipcRenderer.invoke('plugins:getCommands'),
    executeCommand: (id, ...args) => ipcRenderer.invoke('plugins:executeCommand', id, ...args),
    installFromFile: () => ipcRenderer.invoke('plugins:installFromFile'),
    getWebviewPanels: () => ipcRenderer.invoke('plugins:getWebviewPanels'),
    postMessageToWebview: (panelId, message) => ipcRenderer.invoke('plugins:postMessageToWebview', panelId, message),
    onWebviewEvent: (callback) => {
      const listener = (_e: IpcRendererEvent, event: unknown) => callback(event as LoomWebviewEvent);
      ipcRenderer.on('plugins:webview-event', listener);
      return () => ipcRenderer.removeListener('plugins:webview-event', listener);
    },
  },
  skills: {
    getAll: () => ipcRenderer.invoke('skills:getAll'),
  },
  // Extension Marketplace (Cursor / OpenVSX 互通)
  marketplace: {
    list: (query) => ipcRenderer.invoke('marketplace:list', query),
    install: (id) => ipcRenderer.invoke('marketplace:install', id),
    uninstall: (id) => ipcRenderer.invoke('marketplace:uninstall', id),
  },
  mcp: {},
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setAll: (cfg) => ipcRenderer.invoke('settings:setAll', cfg),
  },
  recent: {
    getFolders: () => ipcRenderer.invoke('recent:getFolders'),
  },
  conversations: {},
  team: {
    loadRules: (workspacePath) => ipcRenderer.invoke('team:loadRules', workspacePath),
    saveRules: (workspacePath, content) => ipcRenderer.invoke('team:saveRules', workspacePath, content),
    getUser: () => ipcRenderer.invoke('team:getUser'),
  },
  telemetry: {},
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:open-file'),
    openFolder: async () => {
      const result = await ipcRenderer.invoke('dialog:open-folder');
      if (result?.ok === true) return result.folder;
      if (result?.canceled) return null;
      // Show error notification for non-cancel failures
      if (result?.message) {
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: result.message, type: 'error' } }));
      }
      return null;
    },
    openFolderByPath: (p) => ipcRenderer.invoke('dialog:open-folder-by-path', p),
    saveFile: (p) => ipcRenderer.invoke('dialog:save-file', p),
  },
  fs: {
    readFile: (p) => ipcRenderer.invoke('fs:read-file', p),
    writeFile: (p, c) => ipcRenderer.invoke('fs:write-file', p, c),
    readDir: (p) => ipcRenderer.invoke('fs:read-dir', p),
    exists: (p) => ipcRenderer.invoke('fs:exists', p),
    mkdir: (p) => ipcRenderer.invoke('fs:mkdir', p),
    deletePath: (p) => ipcRenderer.invoke('fs:delete', p),
    rename: (o, n) => ipcRenderer.invoke('fs:rename', o, n),
    indexFiles: (cwd) => ipcRenderer.invoke('fs:index-files', cwd),
    searchFiles: (cwd, query) => ipcRenderer.invoke('fs:search-files', cwd, query),
  },
  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    branches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
    stage: (cwd, file) => ipcRenderer.invoke('git:stage', cwd, file),
    unstage: (cwd, file) => ipcRenderer.invoke('git:unstage', cwd, file),
    commit: (cwd, message) => ipcRenderer.invoke('git:commit', cwd, message),
    pull: (cwd) => ipcRenderer.invoke('git:pull', cwd),
    push: (cwd) => ipcRenderer.invoke('git:push', cwd),
    checkout: (cwd, branch) => ipcRenderer.invoke('git:checkout', cwd, branch),
    log: (cwd, count) => ipcRenderer.invoke('git:log', cwd, count),
    show: (cwd, file) => ipcRenderer.invoke('git:show', cwd, file),
  },
  terminal: {
    create: (id: string, cwd?: string) => ipcRenderer.invoke('terminal:create', id, cwd),
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('terminal:kill', id),
    onData: (id, callback) => {
      const listener = (_e: IpcRendererEvent, tid: string, data: string) => { if (tid === id) callback(data); };
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (id, callback) => {
      const listener = (_e: IpcRendererEvent, tid: string, code: number | null) => { if (tid === id) callback(code); };
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
  },
  app: {
    onOpenFolderRequest: (cb) => {
      const listener = (_e: IpcRendererEvent, folder: string) => cb(folder);
      ipcRenderer.on('app:open-folder', listener);
      return () => ipcRenderer.removeListener('app:open-folder', listener);
    },
  },
  session: {
    save: (data) => ipcRenderer.invoke('session:save', data),
    load: () => ipcRenderer.invoke('session:load'),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  verification: {
    // NOTE: the synchronous `verification:run-command` bridge was removed —
    // it drove a `spawnSync` in the main process (UI freeze up to 120s) and no
    // renderer code used it. Use the streaming `runStream` below.
    runStream: (workspacePath, commandLine, onOutput, onExit) => {
      const id = crypto.randomUUID();
      const listener = (_e: IpcRendererEvent, rid: string, type: string, payload: unknown) => {
        if (rid !== id) return;
        if (type === 'output') {
          const p = payload as { stream: 'stdout' | 'stderr'; data: string };
          onOutput(p.stream, p.data);
        } else if (type === 'exit') {
          cleanup();
          onExit(payload as { exitCode: number | null; stdout: string; stderr: string; error?: string });
        }
      };
      const cleanup = () => ipcRenderer.removeListener('verification:run-event', listener);
      ipcRenderer.on('verification:run-event', listener);
      ipcRenderer.send('verification:run-command-stream', id, workspacePath, commandLine);
      return () => { ipcRenderer.send('verification:run-command-abort', id); cleanup(); };
    },
  },
  debug: {
    start: (scriptPath, cwd) => ipcRenderer.invoke('debug:start', scriptPath, cwd),
    stop: () => ipcRenderer.invoke('debug:stop'),
    onStdout: (cb) => {
      const listener = (_e: IpcRendererEvent, data: string) => cb(data);
      ipcRenderer.on('debug:stdout', listener);
      return () => ipcRenderer.removeListener('debug:stdout', listener);
    },
    onStderr: (cb) => {
      const listener = (_e: IpcRendererEvent, data: string) => cb(data);
      ipcRenderer.on('debug:stderr', listener);
      return () => ipcRenderer.removeListener('debug:stderr', listener);
    },
    onExit: (cb) => {
      const listener = (_e: IpcRendererEvent, code: number | null) => cb(code);
      ipcRenderer.on('debug:exit', listener);
      return () => ipcRenderer.removeListener('debug:exit', listener);
    },
    // 断点调试控制（CDP / Node inspector）
    continue: () => ipcRenderer.invoke('debug:continue'),
    pause: () => ipcRenderer.invoke('debug:pause'),
    step: (kind) => ipcRenderer.invoke('debug:step', kind),
    setBreakpoint: (fileUrl, line) => ipcRenderer.invoke('debug:set-breakpoint', fileUrl, line),
    isConnected: () => ipcRenderer.invoke('debug:is-connected'),
    onPaused: (cb) => {
      const listener = (
        _e: IpcRendererEvent,
        payload: { reason: string; stack: { functionName: string; url: string; line: number; callFrameId: string }[]; variables: { name: string; value?: string }[] },
      ) => cb(payload);
      ipcRenderer.on('debug:paused', listener);
      return () => ipcRenderer.removeListener('debug:paused', listener);
    },
    onResumed: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('debug:resumed', listener);
      return () => ipcRenderer.removeListener('debug:resumed', listener);
    },
  },
  watcher: {
    start: (cwd) => ipcRenderer.invoke('watcher:start', cwd),
    stop: () => ipcRenderer.invoke('watcher:stop'),
    onChange: (cb) => {
      const listener = (_e: IpcRendererEvent, cwd: string, changedPaths: string[]) => cb(cwd, changedPaths);
      ipcRenderer.on('watcher:change', listener);
      return () => ipcRenderer.removeListener('watcher:change', listener);
    },
  },
  history: {
    snapshot: (filePath, content, prevOriginal) =>
      ipcRenderer.invoke('history:snapshot', filePath, content, prevOriginal),
    list: (filePath) => ipcRenderer.invoke('history:list', filePath),
    get: (filePath, ts) => ipcRenderer.invoke('history:get', filePath, ts),
    restore: (filePath, content) => ipcRenderer.invoke('history:restore', filePath, content),
  },
  // Read-only runtime diagnostics for the Debug panel.
  debugRuntime: {
    getState: () => ipcRenderer.invoke('debug:runtime:get'),
  },
};

contextBridge.exposeInMainWorld('loom', loom);

// Expose webUtils.getPathForFile for drag-and-drop file path resolution
// (Electron >=32 deprecated File.path; this is the supported replacement).
if (webUtils?.getPathForFile) {
  contextBridge.exposeInMainWorld('webUtils', {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  });
}
