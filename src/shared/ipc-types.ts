/**
 * IPC Channel Type Safety
 *
 * Provides type-safe wrappers for IPC channels without requiring
 * external dependencies like zod. Uses TypeScript's type system
 * to enforce correct parameter and return types at compile time.
 *
 * Each channel definition includes:
 * - The channel name (string literal type)
 * - Parameter types
 * - Return type
 */

// === Agent Stream Channels ===

export interface AgentStreamRequest {
  messages: Array<{ role: string; content: string; tool_calls?: unknown[] }>;
  workspacePath: string;
  openFiles?: Array<{ path: string; content: string }>;
  options?: {
    plannerMode?: boolean;
    planOnly?: boolean;
    verifyMode?: boolean;
    enableReflection?: boolean;
    tokenBudget?: number;
  };
}

export interface AgentStreamChunk {
  type: 'text' | 'plan' | 'tool_call' | 'tool_result' | 'error' | 'state' | 'memory';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

// === File System Channels ===

export interface FileReadRequest { filePath: string }
export interface FileWriteRequest { filePath: string; content: string }
export interface FileReadDirRequest { dirPath: string }

// === Settings Channels ===

export interface SettingsGetRequest { key?: string }
export interface SettingsSetRequest { key: string; value: unknown }

// === Terminal Channels ===

export interface TerminalCreateRequest { termId: string }
export interface TerminalWriteRequest { termId: string; data: string }
export interface TerminalResizeRequest { termId: string; cols: number; rows: number }

// === Git Channels ===

export interface GitStatusRequest { workspacePath: string }
export interface GitCommitRequest { workspacePath: string; message: string }

// === Channel Map: Enforces all channels have typed definitions ===

export interface ChannelMap {
  // Agent
  'ai:chat-stream': { params: AgentStreamRequest; return: void };
  'ai:chat-stream-chunk': { params: AgentStreamChunk; return: void };
  'ai:agent-chat-chunk': { params: [string, AgentStreamChunk]; return: void };
  'ai:agent-chat-end': { params: [string, unknown]; return: void };
  'ai:agent-chat-error': { params: [string, string]; return: void };
  'ai:agent-state': { params: [string, AgentStreamChunk]; return: void };

  // File system
  'fs:readFile': { params: FileReadRequest; return: string };
  'fs:writeFile': { params: FileWriteRequest; return: boolean };
  'fs:readDir': { params: FileReadDirRequest; return: Array<{ name: string; path: string; isDirectory: boolean }> };

  // Settings
  'settings:get': { params: SettingsGetRequest; return: unknown };
  'settings:set': { params: SettingsSetRequest; return: boolean };

  // Terminal
  'terminal:create': { params: TerminalCreateRequest; return: boolean };
  'terminal:write': { params: TerminalWriteRequest; return: void };
  'terminal:resize': { params: TerminalResizeRequest; return: void };

  // Git
  'git:status': { params: GitStatusRequest; return: { branch: string; changes: Array<{ status: string; file: string }> } };
  'git:commit': { params: GitCommitRequest; return: string };
}

export type ChannelName = keyof ChannelMap;

/**
 * Type-safe IPC invoke wrapper. Usage:
 *   const result = ipcInvoke('fs:readFile', { filePath: '/path/to/file' });
 * The compiler enforces correct params and return type.
 */
export function ipcInvoke<K extends ChannelName>(
  channel: K,
  ...params: ChannelMap[K]['params'] extends void ? [] : [ChannelMap[K]['params']]
): Promise<ChannelMap[K]['return']> {
  // This is a compile-time-only type guard. At runtime it just passes through.
  // The actual implementation lives in preload.ts.
  return (globalThis as any).loom?.[channel]?.(...params);
}
