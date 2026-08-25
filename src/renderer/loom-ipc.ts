// Strongly-typed contract for the `window.loom` IPC bridge exposed by
// src/main/preload.ts via contextBridge.
//
// Previously the renderer called everything through `(window as any).loom...`,
// which bypassed the type system entirely (tsconfig `strict` was effectively
// a no-op for IPC calls). This module:
//   1. Declares the full `Loom` interface mirroring preload.ts.
//   2. Augments `Window` so `window.loom` is typed.
//   3. Exposes `getLoom()` — a null-safe accessor for gradual migration.
//
// Keep this in sync with preload.ts. Prefer `getLoom()?.namespace?.method(...)`
// over `(window as any).loom?....` in new code.
//
// Type policy: RETURN types and CALLBACK params are precise so that migrating a
// call site from `(window as any).loom` to `getLoom()` needs (near) zero casts.
// INPUT params for opaque payloads (message arrays, config patches) stay
// `unknown`/`unknown[]` to avoid coupling this contract to renderer component
// shapes. Domain types that live in `src/agent/*` are imported directly (that
// layer is part of the renderer tsconfig program); main-layer shapes are
// mirrored locally to avoid dragging `src/main/*` into the renderer compile.

import type { AIConfig, AIProvider } from '../agent/ai-engine';
import type { CodeSymbol } from '../agent/code-index';
import type { Skill } from '../agent/skills';
import type {
  DevelopmentCommandEvent,
  DevelopmentCommandResult,
  QueuedDevelopmentCommand,
} from '../agent/development-command';

export interface LoomErrorPayload {
  type: string;
  ts: string;
  msg: string;
}

/** Token usage accounting surfaced by the AI streams and `ai:get-usage`. */
export interface LoomUsage {
  input: number;
  output: number;
  lastUpdated?: number;
}

/** API keys are never sent to the renderer; a `hasKey` flag replaces them. */
export type LoomMaskedProvider = AIProvider & { hasKey?: boolean };
export type LoomMaskedAIConfig = Omit<AIConfig, 'providers'> & {
  providers: LoomMaskedProvider[];
};

export interface LoomEnvProvider {
  providerId: string;
  name: string;
  envVar: string;
  hasKey: boolean;
}

/** One chunk of the agent stream (`ai:agent-chat-chunk`). */
export type LoomAgentStreamChunk =
  | {
      type: 'text' | 'plan' | 'tool_call' | 'tool_result' | 'error';
      content: string;
      toolName?: string;
      toolArgs?: unknown;
    }
  | {
      type: 'task_event';
      content: string;
      taskEvent: DevelopmentCommandEvent;
      toolName?: string;
    };

export interface LoomSubAgentChunk {
  type: 'text' | 'error';
  content: string;
}

export interface LoomCodeIndex {
  search: (workspacePath: string, query: string, topK?: number) => Promise<CodeSymbol[]>;
  prebuild: (workspacePath: string) => Promise<{
    ok: boolean;
    cached?: boolean;
    symbols?: number;
    reason?: 'no-workspace' | 'not-allowed';
  }>;
  /** 单文件符号（Outline 视图；未索引语言由渲染层降级为正则）。 */
  fileSymbols: (workspacePath: string, filePath: string) => Promise<{ name: string; kind: string; line: number; endLine: number }[]>;
}

export interface LoomAIChatStreamHandlers {
  onChunk: (chunk: string) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
  onUsage?: (usage: { input: number; output: number }) => void;
}

export interface LoomAgentChatHandlers {
  onChunk: (chunk: LoomAgentStreamChunk) => void;
  onEnd: (usage?: LoomUsage | null) => void;
  onError: (err: Error) => void;
  /** sid is the current agent stream id — used by the UI to reject pending edits. */
  onFilePreview?: (filePath: string, content: string, existed: boolean, originalContent: string, sid?: string) => void;
  onFileCreated?: (filePath: string, content: string) => void;
  onFileChanged?: (filePath: string, content: string) => void;
  onPlanAwait?: (planText: string, sid: string) => void;
  /** The agent blocked on a delete/rename — the UI must show Approve/Reject. */
  onDestructiveAwait?: (
    request: { type: 'delete' | 'rename'; filePath: string; newPath?: string },
    sid: string,
  ) => void;
}

export interface LoomAgentChatOptions {
  previewFileWrites?: boolean;
  autoApplySafeEdits?: boolean;
  plannerMode?: boolean;
  planOnly?: boolean;
  verifyMode?: boolean;
  /** Currently activated skill id — its prompt is injected into the agent system prompt. */
  activeSkillId?: string;
  /** Resume from a saved agent checkpoint (断点续跑). */
  checkpointId?: string;
}

export interface LoomAI {
  chatStream: (
    messages: unknown[],
    context: string | undefined,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
    onError: (err: Error) => void,
    onUsage?: (usage: { input: number; output: number }) => void,
  ) => () => void;
  getConfig: () => Promise<LoomMaskedAIConfig>;
  updateConfig: (patch: unknown) => Promise<LoomMaskedAIConfig>;
  updateProvider: (id: string, patch: unknown) => Promise<LoomMaskedAIConfig>;
  addProvider: (provider: unknown) => Promise<LoomMaskedAIConfig>;
  removeProvider: (id: string) => Promise<LoomMaskedAIConfig>;
  updateProfile: (id: string, patch: unknown) => Promise<LoomMaskedAIConfig>;
  addProfile: (profile: unknown) => Promise<LoomMaskedAIConfig>;
  removeProfile: (id: string) => Promise<LoomMaskedAIConfig>;
  testConnection: (providerId: string) => Promise<{ ok: boolean; msg: string }>;
  listModels: (providerId: string) => Promise<{ ok: boolean; models: string[]; msg: string }>;
  /** 指定 provider/model 的流式问答，用于「双模型对比」实时显示回复过程。返回取消函数。 */
  askWithStream: (
    providerId: string,
    model: string,
    messages: unknown[],
    context: string | undefined,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
    onError: (err: Error) => void,
    onUsage?: (usage: { input: number; output: number }) => void,
  ) => () => void;
  detectEnvProviders: () => Promise<LoomEnvProvider[]>;
  applyEnvProvider: (
    providerId: string,
  ) => Promise<{ ok: false; msg: string } | { ok: true; config: LoomMaskedAIConfig }>;
  checkOrcaStatus: () => Promise<{ ok: boolean; version?: string; error?: string }>;
  approvePlan: (sid: string) => Promise<boolean>;
  rejectPlan: (sid: string) => Promise<boolean>;
  approveDestructive: (sid: string) => Promise<boolean>;
  rejectDestructive: (sid: string) => Promise<boolean>;
  /**
   * Reject a proposed agent edit. Returns { rejected, applied } — if
   * `applied` is true the change was already written to disk and must be
   * reverted manually.
   */
  rejectAgentEdit: (sid: string, filePath: string) => Promise<{ rejected: boolean; applied: boolean; reason?: string }>;
  /** List saved agent checkpoints for a workspace (newest first). */
  checkpointList: (workspacePath: string) => Promise<{
    ok: boolean;
    checkpoints?: { id: string; createdAt: number; workspacePath: string; messageCount: number; preview: string }[];
    error?: string;
  }>;
  /** Load a checkpoint's conversation so the UI can render it before resuming. */
  checkpointLoad: (workspacePath: string, checkpointId: string) => Promise<{ ok: boolean; checkpoint?: unknown; error?: string }>;
  /** Delete a checkpoint. */
  checkpointDelete: (workspacePath: string, checkpointId: string) => Promise<{ ok: boolean }>;
  agentChatStream: (
    messages: unknown[],
    workspacePath: string,
    openFiles: unknown[] | undefined,
    onChunk: (chunk: LoomAgentStreamChunk) => void,
    onEnd: (usage?: LoomUsage | null) => void,
    onError: (err: Error) => void,
    onFilePreview?: (filePath: string, content: string, existed: boolean, originalContent: string, sid?: string) => void,
    onFileCreated?: (filePath: string, content: string) => void,
    onFileChanged?: (filePath: string, content: string) => void,
    onPlanAwait?: (planText: string, sid: string) => void,
    onDestructiveAwait?: (
      request: { type: 'delete' | 'rename'; filePath: string; newPath?: string },
      sid: string,
    ) => void,
    options?: LoomAgentChatOptions,
  ) => () => void;
}

export interface LoomCliAgentInfo {
  id: string;
  name: string;
  command: string;
  argsTemplate: string[];
  installed: boolean;
  path?: string;
}

export interface LoomCliAgents {
  list: () => Promise<LoomCliAgentInfo[]>;
  run: (agentId: string, prompt: string, cwd?: string) => Promise<string>;
}

/** A queued development command as seen by the renderer (no AbortController). */
export type LoomAgentTask = Omit<QueuedDevelopmentCommand, 'controller'>;

export interface LoomAgentTasks {
  list: () => Promise<LoomAgentTask[]>;
  cancel: (taskId: string) => Promise<boolean>;
  retry: (taskId: string) => Promise<boolean>;
}

export interface LoomPluginManifest {
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  author?: string;
  main?: string;
  engines?: { loom?: string };
  activationEvents?: string[];
  capabilities?: string[];
  contributes?: Record<string, unknown>;
}

export interface LoomPluginInfo {
  id: string;
  manifest: LoomPluginManifest;
  enabled: boolean;
  builtin: boolean;
  path: string;
}

export interface LoomPluginCommand {
  command: string;
  title: string;
  category?: string;
  plugin: string;
  hasHandler: boolean;
}

export interface LoomPluginNotification {
  id: string;
  type: 'info' | 'error' | 'warn';
  message: string;
  plugin: string;
  ts: number;
}

export interface LoomWebviewPanelInfo {
  id: string;
  title: string;
  html?: string;
  url?: string;
}

export interface LoomWebviewEvent {
  type: 'create' | 'dispose' | 'message';
  panelId: string;
  payload?: unknown;
}

export interface LoomPlugins {
  getAll: () => Promise<LoomPluginInfo[]>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  uninstall: (id: string) => Promise<boolean>;
  getCommands: () => Promise<LoomPluginCommand[]>;
  executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>;
  installFromFile: () => Promise<{ ok: boolean; msg: string }>;
  getWebviewPanels: () => Promise<LoomWebviewPanelInfo[]>;
  postMessageToWebview: (panelId: string, message: unknown) => Promise<boolean>;
  onWebviewEvent: (callback: (event: LoomWebviewEvent) => void) => () => void;
}

export interface LoomSkills {
  getAll: () => Promise<Skill[]>;
}

export interface LoomMarketplaceExtension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  category: string;
  version: string;
  downloads: number;
  rating: number;
  iconUrl: string;
  repoUrl?: string;
  manifestUrl: string;
  downloadUrl: string;
  compatibility: string[];
  verified: boolean;
}

export interface LoomInstalledExtension {
  id: string;
  version: string;
  installedAt: number;
  enabled: boolean;
  source: 'marketplace' | 'vsix' | 'cursor' | 'dev';
}

export interface LoomMarketplace {
  list: (query?: string) => Promise<(LoomMarketplaceExtension & { installed: boolean })[]>;
  install: (id: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  uninstall: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export type LoomMcp = Record<string, never>;

export interface LoomSettings {
  // The persisted app config is a main-layer shape (includes decrypted keys);
  // the renderer narrows what it reads, so this stays intentionally opaque.
  getAll: () => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  setAll: (cfg: unknown) => Promise<void>;
}

export interface LoomRecent {
  getFolders: () => Promise<string[]>;
}

export interface LoomConversationSummary {
  name: string;
  projectPath: string;
  mtime: number;
  size: number;
  preview: string;
  messageCount: number;
}

export interface LoomConversationSearchHit {
  projectPath: string;
  snippet: string;
  messageRole: string;
  messageIndex: number;
  timestamp?: number;
  matchScore: number;
}

export type LoomConversations = Record<string, never>;

export interface LoomTeamUser {
  id: string;
  email: string;
  name?: string;
}

export interface LoomTeam {
  loadRules: (workspacePath: string) => Promise<string>;
  saveRules: (
    workspacePath: string,
    content: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  getUser: () => Promise<LoomTeamUser | null>;
}

export type LoomTelemetry = Record<string, never>;

export interface LoomDialog {
  openFile: () => Promise<{ path: string; content: string }[] | null>;
  openFolder: () => Promise<string | null>;
  openFolderByPath: (p: string) => Promise<{ ok: boolean; folder?: string; message?: string }>;
  // SaveFileResult is a main-layer shape; the renderer narrows what it reads.
  saveFile: (p: string) => Promise<unknown | null>;
}

export interface LoomFs {
  // On failure returns a `__ERR__:`-prefixed string instead of throwing.
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, c: string) => Promise<boolean>;
  readDir: (p: string) => Promise<{ name: string; isDirectory: boolean; path: string }[]>;
  exists: (p: string) => Promise<boolean>;
  mkdir: (p: string) => Promise<boolean>;
  deletePath: (p: string) => Promise<boolean>;
  rename: (o: string, n: string) => Promise<boolean>;
  indexFiles: (cwd: string) => Promise<string[]>;
  searchFiles: (cwd: string, query: string) => Promise<string[]>;
}

export interface LoomGitStatus {
  branch: string;
  branches: string[];
  changes: { status: string; file: string }[];
}

export interface LoomGit {
  status: (cwd: string) => Promise<LoomGitStatus>;
  branches: (cwd: string) => Promise<string[]>;
  stage: (cwd: string, file: string) => Promise<boolean>;
  unstage: (cwd: string, file: string) => Promise<boolean>;
  commit: (cwd: string, message: string) => Promise<boolean>;
  // On failure returns an `Error: `-prefixed string instead of throwing.
  pull: (cwd: string) => Promise<string>;
  push: (cwd: string) => Promise<string>;
  checkout: (cwd: string, branch: string) => Promise<boolean>;
  log: (cwd: string, count?: number) => Promise<string[]>;
  /** Original (HEAD or index) content of a file for the diff view; '' for untracked. */
  show: (cwd: string, file: string) => Promise<string>;
}

export interface LoomTerminal {
  create: (id: string, cwd?: string) => Promise<boolean>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  onData: (id: string, callback: (data: string) => void) => () => void;
  onExit: (id: string, callback: (code: number | null) => void) => () => void;
}

export interface LoomWindow {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

export interface LoomShell {
  openExternal: (url: string) => Promise<void>;
  showItemInFolder?: (path: string) => void;
}

export interface LoomRunExitPayload {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  attempts?: number;
}

export interface LoomVerification {
  /**
   * Streaming run ("Run Without Debugging"). stdout/stderr chunks are delivered
   * via `onOutput`; the final result arrives once on `onExit`. The returned
   * function aborts the running command and unsubscribes.
   * (The old synchronous `runCommand` bridge was removed — it blocked the main
   * process with spawnSync and was unused by the renderer.)
   */
  runStream: (
    workspacePath: string,
    commandLine: string,
    onOutput: (stream: 'stdout' | 'stderr', data: string) => void,
    onExit: (result: LoomRunExitPayload) => void,
  ) => () => void;
}

export interface LoomDebug {
  start: (scriptPath: string, cwd: string) => Promise<{ ok: boolean; message: string; cdp?: boolean; connected?: boolean }>;
  stop: () => Promise<{ ok: boolean; message?: string }>;
  onStdout: (cb: (data: string) => void) => () => void;
  onStderr: (cb: (data: string) => void) => () => void;
  onExit: (cb: (code: number | null) => void) => () => void;
  // 断点调试控制（CDP / Node inspector）
  continue: () => Promise<{ ok: boolean; message?: string }>;
  pause: () => Promise<{ ok: boolean; message?: string }>;
  step: (kind: 'over' | 'into' | 'out') => Promise<{ ok: boolean; message?: string }>;
  setBreakpoint: (fileUrl: string, line: number) => Promise<{ ok: boolean; breakpointId?: string; message?: string }>;
  isConnected: () => Promise<{ ok: boolean; connected?: boolean }>;
  onPaused: (cb: (payload: { reason: string; stack: { functionName: string; url: string; line: number; callFrameId: string }[]; variables: { name: string; value?: string }[] }) => void) => () => void;
  onResumed: (cb: () => void) => () => void;
}

export interface LoomWatcher {
  start: (cwd: string) => Promise<boolean>;
  stop: () => Promise<boolean>;
  onChange: (cb: (cwd: string, changedPaths: string[]) => void) => () => void;
}

export interface LoomHistorySnapshot {
  ts: number;
  size: number;
  isInitial: boolean;
}

export interface LoomHistory {
  snapshot: (filePath: string, content: string, prevOriginal: string) => Promise<boolean>;
  list: (filePath: string) => Promise<LoomHistorySnapshot[]>;
  get: (filePath: string, ts: number) => Promise<string | null>;
  restore: (filePath: string, content: string) => Promise<boolean>;
}

export interface LoomDebugRuntime {
  getState: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

export interface LoomUpdate {
  check: () => Promise<{ ok: boolean; reason?: string; current?: string; hasUpdate?: boolean; message?: string }>;
}

/** 主进程应用级事件（CLI / loom:// 协议 / 单实例二次启动）。 */
export interface LoomApp {
  onOpenFolderRequest: (cb: (folder: string) => void) => () => void;
}

/** 磁盘会话存储（替代 localStorage 的大文件持久化）。 */
export interface LoomSession {
  save: (data: unknown) => Promise<{ ok: boolean }>;
  load: () => Promise<{ ok: boolean; data: unknown | null }>;
}

export interface Loom {
  reportError: (payload: LoomErrorPayload) => void;
  codeIndex: LoomCodeIndex;
  ai: LoomAI;
  cliAgents: LoomCliAgents;
  agentTasks: LoomAgentTasks;
  plugins: LoomPlugins;
  skills: LoomSkills;
  marketplace: LoomMarketplace;
  mcp: LoomMcp;
  settings: LoomSettings;
  recent: LoomRecent;
  conversations: LoomConversations;
  team: LoomTeam;
  telemetry: LoomTelemetry;
  dialog: LoomDialog;
  fs: LoomFs;
  git: LoomGit;
  terminal: LoomTerminal;
  window: LoomWindow;
  update: LoomUpdate;
  app: LoomApp;
  session: LoomSession;
  shell: LoomShell;
  verification: LoomVerification;
  debug: LoomDebug;
  watcher: LoomWatcher;
  history: LoomHistory;
  debugRuntime: LoomDebugRuntime;
}

declare global {
  interface Window {
    loom: Loom;
  }
}

/** Null-safe accessor for the IPC bridge. Returns `undefined` only before preload runs. */
export function getLoom(): Loom | undefined {
  return (window as unknown as { loom?: Loom }).loom;
}
