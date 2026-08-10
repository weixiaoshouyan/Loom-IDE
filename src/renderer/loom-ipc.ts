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
import type { CodeIndex, CodeSymbol } from '../agent/code-index';
import type { Skill } from '../agent/skills';
import type { MCPServerConfig, MCPTool } from '../agent/mcp-client';
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
  build: (workspacePath: string) => Promise<CodeIndex>;
  search: (workspacePath: string, query: string, topK?: number) => Promise<CodeSymbol[]>;
  prebuild: (workspacePath: string) => Promise<{
    ok: boolean;
    cached?: boolean;
    symbols?: number;
    reason?: 'no-workspace' | 'not-allowed';
  }>;
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
}

export interface LoomAI {
  chat: (messages: unknown[], context?: string) => Promise<string>;
  chatStream: (
    messages: unknown[],
    context: string | undefined,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
    onError: (err: Error) => void,
    onUsage?: (usage: { input: number; output: number }) => void,
  ) => () => void;
  getUsage: () => Promise<LoomUsage>;
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
  askWith: (
    providerId: string,
    model: string,
    messages: unknown[],
    context?: string,
  ) => Promise<{ text: string; usage: { input: number; output: number } }>;
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
  getOrcaProviders: () => Promise<unknown[]>;
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
  subAgentStream: (
    request: string,
    workspacePath: string,
    openFiles: unknown[] | undefined,
    onChunk: (chunk: LoomSubAgentChunk) => void,
    onEnd: () => void,
    onError: (err: Error) => void,
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
  get: (taskId: string) => Promise<LoomAgentTask | null | undefined>;
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
  install: (pluginPath: string) => Promise<{ ok: boolean; msg: string }>;
  uninstall: (id: string) => Promise<boolean>;
  getCommands: () => Promise<LoomPluginCommand[]>;
  executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>;
  getConfigurations: () => Promise<
    Record<string, { type: string; default: unknown; description?: string; plugin: string }>
  >;
  getUserConfig: () => Promise<Record<string, unknown>>;
  setUserConfig: (key: string, value: unknown) => Promise<boolean>;
  getNotifications: () => Promise<LoomPluginNotification[]>;
  clearNotifications: () => Promise<boolean>;
  installFromFile: () => Promise<{ ok: boolean; msg: string }>;
  getWebviewPanels: () => Promise<LoomWebviewPanelInfo[]>;
  postMessageToWebview: (panelId: string, message: unknown) => Promise<boolean>;
  onWebviewEvent: (callback: (event: LoomWebviewEvent) => void) => () => void;
}

export interface LoomSkills {
  getAll: () => Promise<Skill[]>;
  getByCategory: (category: string) => Promise<Skill[]>;
  resolvePrompt: (skillId: string, variables: Record<string, string>) => Promise<string | null>;
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
  listInstalled: () => Promise<LoomInstalledExtension[]>;
}

export interface LoomMcp {
  getServers: () => Promise<MCPServerConfig[]>;
  addServer: (config: unknown) => Promise<{ ok: boolean; message?: string }>;
  updateServer: (id: string, patch: unknown) => Promise<{ ok: boolean; message?: string }>;
  removeServer: (id: string) => Promise<boolean>;
  connect: (serverId: string) => Promise<{ ok: boolean; message: string }>;
  disconnect: (serverId: string) => Promise<boolean>;
  getTools: () => Promise<MCPTool[]>;
  callTool: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: true; result: unknown } | { ok: false; message: string }>;
}

export interface LoomSettings {
  // The persisted app config is a main-layer shape (includes decrypted keys);
  // the renderer narrows what it reads, so this stays intentionally opaque.
  getAll: () => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  setAll: (cfg: unknown) => Promise<void>;
}

export interface LoomRecent {
  getFolders: () => Promise<string[]>;
  clearFolders: () => Promise<void>;
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

export interface LoomConversations {
  save: (projectPath: string, messages: unknown[]) => Promise<boolean>;
  load: (projectPath: string) => Promise<unknown[]>;
  list: () => Promise<LoomConversationSummary[]>;
  delete: (projectPath: string) => Promise<boolean>;
  clear: () => Promise<boolean>;
  search: (query: string, limit?: number) => Promise<LoomConversationSearchHit[]>;
  export: (
    projectPath: string,
    format: 'markdown' | 'json',
  ) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
}

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
  signIn: (credentials?: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

export interface LoomTelemetry {
  setConfig: (config: unknown) => Promise<{ ok: true }>;
  getAuditLog: () => Promise<unknown[]>;
  clearAuditLog: () => Promise<{ ok: true }>;
}

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
  stat: (p: string) => Promise<{ isDirectory: boolean; size: number; mtime: number }>;
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
  diff: (cwd: string, file?: string) => Promise<string>;
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
  onMaximized: (cb: (maximized: boolean) => void) => () => void;
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
  runCommand: (
    workspacePath: string,
    commandLine: string,
  ) => Promise<{ command: string } & DevelopmentCommandResult>;
  /**
   * Streaming run ("Run Without Debugging"). stdout/stderr chunks are delivered
   * via `onOutput`; the final result arrives once on `onExit`. The returned
   * function aborts the running command and unsubscribes.
   */
  runStream: (
    workspacePath: string,
    commandLine: string,
    onOutput: (stream: 'stdout' | 'stderr', data: string) => void,
    onExit: (result: LoomRunExitPayload) => void,
  ) => () => void;
}

export interface LoomDebug {
  start: (scriptPath: string, cwd: string) => Promise<{ ok: boolean; message: string }>;
  stop: () => Promise<{ ok: boolean; message?: string }>;
  onStdout: (cb: (data: string) => void) => () => void;
  onStderr: (cb: (data: string) => void) => () => void;
  onExit: (cb: (code: number | null) => void) => () => void;
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
