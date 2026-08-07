/**
 * Agent callback factory — builds the shared callback object used by both
 * `agentChatStream` and `subAgentStream`.
 *
 * Previously this ~200-line object was duplicated almost verbatim between the
 * `ai:agent-chat-stream` and `ai:sub-agent-stream` IPC handlers. Extracting it
 * here keeps both modes consistent and makes future changes a single-edit
 * operation.
 *
 * Route-all-output-through-mainWindow: callbacks that fire during streaming
 * use `sendToRenderer()`, which always targets the current primary window
 * instead of a captured `event.sender` (which breaks on window close/reload).
 */
import { telemetry } from './telemetry';
import { runGit } from './git-handlers';
import {
  buildCodeIndex, loadCodeIndex, saveCodeIndex, searchCodeIndex,
} from '../agent/code-index';
import { DevelopmentCommandQueue, DevelopmentCommandRequest, DevelopmentCommandEvent, DevelopmentCommandResult } from '../agent/development-command';

// Module-level singletons, set by index.ts during `whenReady`.
let resolvedMainWindow: { webContents: { send: (...args: any[]) => void; isDestroyed: () => boolean } } | null = null;
let _mcpClient: any = null;
let _skillManager: any = null;
let _codeIndexDirFn: (wp: string) => string = () => '';
let _cloudSync: any = null;
let _agentCommandQueue: DevelopmentCommandQueue | null = null;

// Per-session code-index cache keyed by workspacePath.
const codeIndexCache = new Map<string, any>();

export function setAgentCallbackSingletons(opts: {
  mainWindow: any;
  mcpClient: any;
  skillManager: any;
  codeIndexDirFn: (wp: string) => string;
  cloudSync: any;
  agentCommandQueue: DevelopmentCommandQueue;
}) {
  resolvedMainWindow = opts.mainWindow;
  _mcpClient = opts.mcpClient;
  _skillManager = opts.skillManager;
  _codeIndexDirFn = opts.codeIndexDirFn;
  _cloudSync = opts.cloudSync;
  _agentCommandQueue = opts.agentCommandQueue;
  codeIndexCache.clear();
}

function sendToRenderer(channel: string, ...args: any[]) {
  const wc = resolvedMainWindow?.webContents;
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
}

/**
 * Build the callback set for a single agent/sub-agent streaming session.
 *
 * @param id            Stream id (namespaces the IPC channels).
 * @param workspacePath The workspace this session operates on.
 * @param mode          'agent' routes to `ai:agent-*`, 'sub-agent' to `ai:sub-agent-*`.
 */
export function buildAgentCallbacks(
  id: string,
  workspacePath: string,
  mode: 'agent' | 'sub-agent',
) {
  const chunkChan = mode === 'agent' ? 'ai:agent-chat-chunk' : 'ai:sub-agent-chunk';

  const onTaskEvent = (taskEvent: DevelopmentCommandEvent) => {
    sendToRenderer(chunkChan, id, {
      type: 'task_event',
      content: taskEvent.data || taskEvent.error || '',
      taskEvent,
      toolName: 'run_command',
    });
  };

  const onSearchCode = async (query: string, topK: number) => {
    let idx = codeIndexCache.get(workspacePath);
    if (!idx || idx.workspacePath !== workspacePath) {
      const cached = loadCodeIndex(_codeIndexDirFn(workspacePath));
      if (cached && cached.workspacePath === workspacePath) {
        idx = cached;
      } else {
        idx = await buildCodeIndex(workspacePath);
        saveCodeIndex(idx, _codeIndexDirFn(workspacePath));
      }
      codeIndexCache.set(workspacePath, idx);
    }
    return searchCodeIndex(idx, query, topK);
  };

  // ---- Agent-only callbacks (sub-agent has no skill activation / file preview).
  const onActivateSkill = mode === 'agent'
    ? (skillId: string) => sendToRenderer('ai:skill-activated', id, skillId)
    : undefined;

  const onFilePreview = mode === 'agent'
    ? (filePath: string, content: string, existed: boolean, originalContent?: string) => {
        sendToRenderer('ai:agent-file-preview', id, filePath, content, existed, originalContent);
      }
    : undefined;

  const onFileCreated = mode === 'agent'
    ? (filePath: string, content: string) => {
        sendToRenderer('ai:agent-file-created', id, filePath, content);
      }
    : undefined;

  const onFileChanged = mode === 'agent'
    ? (filePath: string, content: string) => {
        sendToRenderer('ai:agent-file-changed', id, filePath, content);
      }
    : undefined;

  return {
    // Skills (agent only).
    onActivateSkill,

    // MCP tool calls.
    onCallMcpTool: async (serverId: string, toolName: string, args: Record<string, any>) => {
      return _mcpClient?.callTool(serverId, toolName, args);
    },

    // Git operations scoped to this session's workspace.
    onGitCommand: async (command: string, args: string[]) => {
      return runGit(workspacePath, [command, ...args]);
    },

    // Audit telemetry.
    onAudit: (actor: 'agent', action: string, target?: string, details?: Record<string, any>) => {
      // Coerce to string to satisfy telemetry.audit's looser signature.
      telemetry.audit(actor, action, target ?? '', details ?? {});
    },

    // Development command queue events.
    onTaskEvent,
    onRunCommand: (request: DevelopmentCommandRequest, onEvent?: (e: DevelopmentCommandEvent) => void)
      : Promise<DevelopmentCommandResult & { history: DevelopmentCommandEvent[] }> => {
      return _agentCommandQueue
        ? _agentCommandQueue.enqueue(request, onEvent)
            .then((r: any) => ({ ...r, history: r.history ?? [] }) as DevelopmentCommandResult & { history: DevelopmentCommandEvent[] })
            .catch((err: any): DevelopmentCommandResult & { history: DevelopmentCommandEvent[] } => ({
              exitCode: 1,
              stdout: '',
              stderr: err?.message ?? 'command queue error',
              history: [],
            }))
        : Promise.resolve({
            exitCode: 1,
            stdout: '',
            stderr: 'No command queue available',
            history: [],
          } as DevelopmentCommandResult & { history: DevelopmentCommandEvent[] });
    },

    // Symbol search over the workspace's Tree-sitter index.
    onSearchCode,

    // File preview / create / change (agent mode only).
    onFilePreview,
    onFileCreated,
    onFileChanged,
  };
}

/** Exposed so callers can build the shared context/skills/mcp meta-blobs too. */
export function getSkillManager() { return _skillManager; }
export function getMcpClient() { return _mcpClient; }
export function getCloudSync() { return _cloudSync; }
