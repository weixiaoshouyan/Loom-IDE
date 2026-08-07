/**
 * AI streaming IPC — chat, chat-stream, agent-chat-stream, sub-agent-stream.
 *
 * All four streaming handlers share the same abort-tracking map (`activeStreams`)
 * and route their output through `mainWindow?.webContents` (never a captured
 * `event.sender`).
 *
 * Agent and sub-agent sessions build their callback objects via
 * `buildAgentCallbacks()` in `./agent-callbacks`, eliminating the ~200 lines
 * of duplicate callback definitions that used to live here.
 */
import { ipcMain } from 'electron';
import path from 'path';
import { app } from 'electron';
import { AIEngine, ChatMessage } from '../agent/ai-engine';
import { buildAgentCallbacks, setAgentCallbackSingletons, getSkillManager, getMcpClient, getCloudSync } from './agent-callbacks';
import { DevelopmentCommandQueue } from '../agent/development-command';
import { canAccess } from './path-permissions';

// ---- Shared state (set by index.ts) ----------------------------------------
let resolvedMainWindow: { webContents: { send: (...args: any[]) => void; isDestroyed: () => boolean } } | null = null;
let _aiEngine: AIEngine | null = null;
let _mcpClient: any = null;
let _skillManager: any = null;
let _cloudSync: any = null;
let _commandQueue: DevelopmentCommandQueue | null = null;

/**
 * Per-stream edit review gates. `ai:agent-reject-edit` marks a proposed file
 * change as rejected; the agent's apply_pending_edits then skips it (see
 * ToolExecutionContext.editGate in agent-tools.ts). Cleared when the stream ends.
 */
const pendingEditGates = new Map<string, Map<string, 'pending' | 'rejected' | 'applied'>>();

export function setAIStreamSingletons(opts: {
  mainWindow: any;
  aiEngine: AIEngine;
  mcpClient: any;
  skillManager: any;
  cloudSync: any;
  commandQueue: DevelopmentCommandQueue;
}) {
  resolvedMainWindow = opts.mainWindow;
  _aiEngine = opts.aiEngine;
  _mcpClient = opts.mcpClient;
  _skillManager = opts.skillManager;
  _cloudSync = opts.cloudSync;
  _commandQueue = opts.commandQueue;

  // Push the same singletons into the callback factory.
  setAgentCallbackSingletons({
    mainWindow: opts.mainWindow,
    mcpClient: opts.mcpClient,
    skillManager: opts.skillManager,
    codeIndexDirFn: (wp: string) => path.join(app.getPath('userData'), 'loom-index', encodeURIComponent(wp)),
    cloudSync: opts.cloudSync,
    agentCommandQueue: opts.commandQueue,
  });
}

function ensureAIEngine() {
  if (!_aiEngine) {
    throw new Error('AIEngine not initialized — setAIStreamSingletons() must be called first.');
  }
}

const activeStreams = new Map<string, { abort: boolean; controller?: AbortController }>();
const pendingPlanApprovals = new Map<string, (approved: boolean) => void>();

function sendToRenderer(channel: string, ...args: any[]) {
  const wc = resolvedMainWindow?.webContents;
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
}

function getEngine(): AIEngine {
  ensureAIEngine();
  return _aiEngine!;
}

// Bound the message list every AI handler accepts — unbounded arrays from the
// renderer would let a single IPC call chew arbitrary amounts of memory.
const MAX_AI_MESSAGES = 500;
const MAX_AI_MESSAGE_CHARS = 200_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 消息来自 IPC（renderer 端已是 any），此处仅做上限截断
function sanitizeMessages(messages: any[] | undefined | null): any[] {
  if (!Array.isArray(messages)) return [];
  return messages.slice(0, MAX_AI_MESSAGES).map((m) => {
    if (!m || typeof m !== 'object') return { role: 'user', content: '' };
    const c = typeof m.content === 'string' ? m.content.slice(0, MAX_AI_MESSAGE_CHARS) : m.content;
    return { ...m, content: c };
  });
}

// ---- Plain chat (non-streaming, returns full response) ---------------------
export function registerAIHandlers() {
  ipcMain.handle('ai:chat', async (_event: any, messages: ChatMessage[], context?: string) => {
    return getEngine().chat(sanitizeMessages(messages) as ChatMessage[], context);
  });

  ipcMain.handle('ai:get-usage', () => getEngine().getTokenUsage());

  ipcMain.handle('ai:ask-with', async (_event: any, providerId: string, model: string, messages: any[], context?: string) => {
    return getEngine().askWith(providerId, model, sanitizeMessages(messages), context);
  });

  // ---- 指定模型流式问答（双模型对比用）---------------------------------------
  ipcMain.on('ai:ask-with-stream', (event: any, id: string, providerId: string, model: string, messages: ChatMessage[], context?: string) => {
    const controller = new AbortController();
    const streamState = { abort: false, controller };
    activeStreams.set(id, streamState);
    (async () => {
      try {
        const generator = getEngine().askWithStream(providerId, model, messages, context, controller.signal, id);
        for await (const chunk of generator) {
          if (streamState.abort) break;
          sendToRenderer('ai:ask-with-stream-chunk', id, chunk);
        }
        const lastUsage = getEngine().getTokenUsage(id) || getEngine().lastUsage;
        if (lastUsage) sendToRenderer('ai:ask-with-stream-usage', id, lastUsage);
        sendToRenderer('ai:ask-with-stream-end', id);
      } catch (e: any) {
        sendToRenderer('ai:ask-with-stream-error', id, e.message || 'Unknown error');
      } finally {
        activeStreams.delete(id);
      }
    })();
  });

  ipcMain.on('ai:ask-with-stream-abort', (_event: any, id: string) => {
    const s = activeStreams.get(id);
    if (s) { s.abort = true; s.controller?.abort(); }
  });

  // ---- Chat streaming -------------------------------------------------------
  ipcMain.on('ai:chat-stream', (event: any, id: string, messages: ChatMessage[], context?: string) => {
    const controller = new AbortController();
    const streamState = { abort: false, controller };
    activeStreams.set(id, streamState);
    (async () => {
      try {
        const generator = getEngine().chatStream(messages, context, controller.signal, id);
        for await (const chunk of generator) {
          if (streamState.abort) break;
          sendToRenderer('ai:chat-stream-chunk', id, chunk);
        }
        const lastUsage = getEngine().getTokenUsage(id) || getEngine().lastUsage;
        if (lastUsage) sendToRenderer('ai:chat-stream-usage', id, lastUsage);
        sendToRenderer('ai:chat-stream-end', id);
      } catch (e: any) {
        sendToRenderer('ai:chat-stream-error', id, e.message || 'Unknown error');
      } finally {
        activeStreams.delete(id);
      }
    })();
  });

  ipcMain.on('ai:chat-stream-abort', (_event: any, id: string) => {
    const s = activeStreams.get(id);
    if (s) { s.abort = true; s.controller?.abort(); }
  });

  // ---- Agent chat (tool-calling loop) ---------------------------------------
  ipcMain.on('ai:agent-chat-stream', (event: any, id: string, messages: any[], workspacePath: string, openFiles?: any[], options?: any) => {
    // SECURITY: the agent runs git commands, reads rules and indexes files
    // under workspacePath. Without a granted workspace, file tools and
    // command execution would fall back to the process cwd — refuse instead.
    if (!workspacePath || !canAccess(workspacePath)) {
      sendToRenderer('ai:agent-chat-error', id, 'Agent 模式需要先打开一个文件夹作为工作区。');
      return;
    }
    messages = sanitizeMessages(messages);
    const controller = new AbortController();
    const streamState = { abort: false, controller };
    activeStreams.set(id, streamState);
    const editGate = new Map<string, 'pending' | 'rejected' | 'applied'>();
    pendingEditGates.set(id, editGate);

    const callbacks = buildAgentCallbacks(id, workspacePath, 'agent');

    (async () => {
      try {
        const generator = getEngine().agentChatStream(messages, {
          workspacePath,
          streamId: id,
          openFiles: openFiles || [],
          diagnostics: [],
          previewFileWrites: options?.previewFileWrites !== false,
          autoApplySafeEdits: options?.autoApplySafeEdits === true,
          abortSignal: controller.signal,
          teamRules: getCloudSync()?.formatRulesPrompt(getCloudSync()?.loadTeamRules(workspacePath)) || '',
          skills: getSkillManager()?.getAll().map((s: any) => ({ id: s.id, name: s.name, description: s.description })) || [],
          mcpServers: getMcpClient()?.getAllServers().map((s: any) => ({
            id: s.id,
            name: s.name,
            tools: getMcpClient()?.getServerTools(s.id).map((t: any) => ({ name: t.name, description: t.description || '' })) || [],
          })) || [],
          editGate,
          activeSkillId: options?.activeSkillId,
          onActivateSkill: callbacks.onActivateSkill,
          onCallMcpTool: callbacks.onCallMcpTool,
          onGitCommand: callbacks.onGitCommand,
          onAudit: callbacks.onAudit,
          onTaskEvent: callbacks.onTaskEvent,
          onRunCommand: callbacks.onRunCommand,
          onSearchCode: callbacks.onSearchCode,
          onFilePreview: callbacks.onFilePreview,
          onFileCreated: callbacks.onFileCreated,
          onFileChanged: callbacks.onFileChanged,
        }, 15, controller.signal, {
          plannerMode: options?.plannerMode === true,
          planOnly: options?.planOnly === true,
          verifyMode: options?.verifyMode === true,
          planApproval: options?.plannerMode === true
            ? (planText: string) => new Promise<boolean>((resolve, reject) => {
                pendingPlanApprovals.set(id, resolve);
                sendToRenderer('ai:agent-plan-await', id, planText);
                const onAbort = () => {
                  pendingPlanApprovals.delete(id);
                  reject(new Error('Plan approval aborted (stream cancelled).'));
                };
                if (controller.signal.aborted) onAbort();
                else controller.signal.addEventListener('abort', onAbort, { once: true });
              })
            : undefined,
        });

        for await (const chunk of generator) {
          if (streamState.abort) break;
          sendToRenderer('ai:agent-chat-chunk', id, chunk);
        }
        if (!streamState.abort) {
          sendToRenderer('ai:agent-chat-end', id, getEngine().getTokenUsage(id) || getEngine().lastUsage || null);
        }
      } catch (e: any) {
        sendToRenderer('ai:agent-chat-error', id, e.message || 'Unknown error');
      } finally {
        activeStreams.delete(id);
        pendingPlanApprovals.delete(id);
        pendingEditGates.delete(id);
      }
    })();
  });

  // Planner approve/reject.
  ipcMain.handle('ai:agent-plan-approve', (_e: any, sid: string) => {
    const r = pendingPlanApprovals.get(sid);
    if (r) { pendingPlanApprovals.delete(sid); r(true); }
    return true;
  });
  ipcMain.handle('ai:agent-plan-reject', (_e: any, sid: string) => {
    const r = pendingPlanApprovals.get(sid);
    if (r) { pendingPlanApprovals.delete(sid); r(false); }
    return true;
  });

  /**
   * Mark a proposed agent file edit as rejected. If the change was already
   * applied to disk the agent cannot undo it automatically — the caller is
   * told so it can offer manual revert instead of claiming a rollback.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 与既有 plan approve/reject handler 一致
  ipcMain.handle('ai:agent-reject-edit', (_e: any, sid: string, filePath: string) => {
    const gate = pendingEditGates.get(sid);
    if (!gate || !filePath) {
      return { rejected: false, applied: true, reason: 'stream finished or unknown file' };
    }
    const state = gate.get(filePath);
    if (state === 'applied') {
      return { rejected: false, applied: true, reason: 'change was already applied to disk' };
    }
    gate.set(filePath, 'rejected');
    return { rejected: true, applied: false };
  });

  // ---- Sub-agent (parallel exploration) -------------------------------------
  ipcMain.on('ai:sub-agent-stream', (event: any, id: string, request: string, workspacePath: string, openFiles?: any[]) => {
    // SECURITY: same boundary as ai:agent-chat-stream.
    if (!workspacePath || !canAccess(workspacePath)) {
      sendToRenderer('ai:sub-agent-error', id, 'Agent 模式需要先打开一个文件夹作为工作区。');
      return;
    }
    const controller = new AbortController();
    const streamState = { abort: false, controller };
    activeStreams.set(id, streamState);

    const callbacks = buildAgentCallbacks(id, workspacePath, 'sub-agent');

    (async () => {
      try {
        const generator = getEngine().subAgentStream(request, {
          workspacePath,
          openFiles: openFiles || [],
          diagnostics: [],
          previewFileWrites: true,
          abortSignal: controller.signal,
          teamRules: getCloudSync()?.formatRulesPrompt(getCloudSync()?.loadTeamRules(workspacePath)) || '',
          skills: getSkillManager()?.getAll().map((s: any) => ({ id: s.id, name: s.name, description: s.description })) || [],
          mcpServers: getMcpClient()?.getAllServers().map((s: any) => ({
            id: s.id,
            name: s.name,
            tools: getMcpClient()?.getServerTools(s.id).map((t: any) => ({ name: t.name, description: t.description || '' })) || [],
          })) || [],
          onCallMcpTool: callbacks.onCallMcpTool,
          onGitCommand: callbacks.onGitCommand,
          onAudit: callbacks.onAudit,
          onTaskEvent: callbacks.onTaskEvent,
          onRunCommand: callbacks.onRunCommand,
          onSearchCode: callbacks.onSearchCode,
        }, controller.signal);

        for await (const chunk of generator) {
          if (streamState.abort) break;
          sendToRenderer('ai:sub-agent-chunk', id, chunk);
        }
        sendToRenderer('ai:sub-agent-end', id);
      } catch (e: any) {
        sendToRenderer('ai:sub-agent-error', id, e.message || 'Unknown error');
      } finally {
        activeStreams.delete(id);
      }
    })();
  });
}

// Exported for the Debug panel — surfaces active stream ids/ages.
export function getActiveStreamsSnapshot(): { id: string; startedAt: number; provider?: string; model?: string }[] {
  const out: { id: string; startedAt: number; provider?: string; model?: string }[] = [];
  activeStreams.forEach((_s, id) => {
    out.push({ id, startedAt: Date.now() });
  });
  return out;
}

// Exported for app lifecycle cleanup.
export function abortAllStreams() {
  activeStreams.forEach((s) => { try { s.abort = true; s.controller?.abort(); } catch {} });
  activeStreams.clear();
  pendingPlanApprovals.forEach((resolve) => { try { resolve(false); } catch {} });
  pendingPlanApprovals.clear();
}
