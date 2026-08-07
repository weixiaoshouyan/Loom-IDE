/**
 * Loom Agent Tool System
 * Implements Cursor-like agent capabilities: file read/write/edit, code search,
 * terminal execution, file listing, and code analysis.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import type { CodeSymbol } from './code-index';
import type { Scratchpad } from './scratchpad';
import type { AgentStateSnapshot } from './agent-state-machine';
import type { TokenBudgetEvent } from './token-budget';

/**
 * Yield to the event loop so a long-running file scan doesn't block IPC,
 * streaming, or other async work in the main process. Used inside the
 * async-by-default searchDir loop — every N files we await this to keep
 * the process responsive.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
import {
  runDevelopmentCommandStreaming,
  type DevelopmentCommandEvent,
  type DevelopmentCommandRequest,
  type DevelopmentCommandResult,
} from './development-command';

// === Tool Definitions ===

export interface AgentToolParameterProp {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string; properties?: Record<string, { type: string; description: string }>; required?: string[] };
  properties?: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, AgentToolParameterProp>;
    required: string[];
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine code, configuration, or any text file in the project.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or relative path to the file to read' },
        startLine: { type: 'number', description: 'Optional: Starting line number (1-indexed)' },
        endLine: { type: 'number', description: 'Optional: Ending line number (1-indexed, inclusive)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Use this to create new files or completely rewrite existing ones.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or relative path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['filePath', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Perform exact string replacements in an existing file. Use this for precise edits without rewriting the entire file. Only replaces the first occurrence unless replaceAll is true.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or relative path to the file to edit' },
        oldString: { type: 'string', description: 'The exact text to replace (must match exactly, including whitespace)' },
        newString: { type: 'string', description: 'The new text to replace it with' },
        replaceAll: { type: 'boolean', description: 'Optional: Replace all occurrences (default false)' },
      },
      required: ['filePath', 'oldString', 'newString'],
    },
  },
  {
    name: 'search_code',
    description: 'Search the workspace for code. If "query" is provided, performs a semantic search over the code index first; otherwise "pattern" is used for text/regex grep.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query for semantic symbol search (e.g. "user authentication")' },
        pattern: { type: 'string', description: 'Text or regex pattern for grep search. Used as fallback when query is omitted.' },
        fileTypes: { type: 'string', description: 'Optional: Comma-separated file extensions to filter grep search (e.g., ".ts,.tsx,.js")' },
        maxResults: { type: 'number', description: 'Optional: Maximum grep results (default 20)' },
        topK: { type: 'number', description: 'Optional: Maximum semantic search results (default 10)' },
        caseSensitive: { type: 'boolean', description: 'Optional: Case-sensitive grep (default false)' },
        useRegex: { type: 'boolean', description: 'Optional: Treat pattern as regex for grep (default false)' },
      },
      required: [],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories in a given directory. Use this to explore the project structure.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: 'Absolute or relative path to the directory to list' },
        depth: { type: 'number', description: 'Optional: Recursion depth (default 1, max 3)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a development command and return the output. Use this for running tests, builds, linting, PowerShell workspace automation, or any dev tool. Provide the executable name in "command" and all arguments in "args". Shell redirects are not allowed; PowerShell is constrained by a safety policy.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Executable name (e.g. "npm", "node", "tsc", "git"). Must be in the allowed list.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Array of arguments for the command (e.g. ["test"]).' },
        cwd: { type: 'string', description: 'Optional: Working directory for the command, relative to the workspace root.' },
        timeoutMs: { type: 'number', description: 'Optional command timeout in milliseconds. Defaults to 120000 and is capped at 600000 for long tests/builds.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_diagnostics',
    description: 'Get current diagnostics (errors, warnings) for a file or all open files. Use this to understand what problems exist in the code.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Optional: Specific file to get diagnostics for. If omitted, returns diagnostics for all files.' },
      },
      required: [],
    },
  },
  {
    name: 'read_lints',
    description: 'Read and display linter errors from the current workspace. Use this to identify and fix code quality issues.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'string', description: 'Optional: Specific file or directory path to lint. If omitted, lints the entire workspace.' },
      },
      required: [],
    },
  },
  {
    name: 'create_checkpoint',
    description: 'Create a checkpoint of the current workspace state before making risky changes. Uses git stash if the workspace is a git repository, otherwise backs up modified files to .loom/checkpoints/.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Optional label for the checkpoint' },
      },
      required: [],
    },
  },
  {
    name: 'restore_checkpoint',
    description: 'Restore the workspace to the most recent checkpoint created by create_checkpoint.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a new directory in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: 'Path of the directory to create (relative to workspace or absolute)' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or empty directory. Use with caution as this operation cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path of the file or directory to delete' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file/directory from one path to another.',
    parameters: {
      type: 'object',
      properties: {
        oldPath: { type: 'string', description: 'Current path of the file/directory' },
        newPath: { type: 'string', description: 'New path for the file/directory' },
      },
      required: ['oldPath', 'newPath'],
    },
  },
  {
    name: 'git_status',
    description: 'Get the current git status including branch, staged/unstaged changes. Use this to understand the repository state.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_diff',
    description: 'Get the diff of changes. Can show diff of a specific file or all changes.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Optional: Specific file to diff. If omitted, shows all changes.' },
      },
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit with the provided message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The commit message' },
      },
      required: ['message'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all available AI skills/plugins that can enhance my capabilities. Use this to discover what specialized tools are available.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'use_skill',
    description: 'Activate a specific skill to gain specialized capabilities for a task.',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'The ID of the skill to activate' },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'list_mcp_tools',
    description: 'List all available MCP (Model Context Protocol) tools from connected servers. Use this to discover external integrations.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'call_mcp_tool',
    description: 'Call an MCP tool with the specified arguments. Use this to interact with external services via MCP.',
    parameters: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'The MCP server ID' },
        toolName: { type: 'string', description: 'The tool name to call' },
        args: { type: 'object', description: 'The arguments for the tool call' },
      },
      required: ['serverId', 'toolName', 'args'],
    },
  },
  {
    name: 'analyze_dependencies',
    description: 'Analyze the import/dependency relationships of a file. Shows which files this file imports and which files import this file. Use this to understand the impact of changes.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path of the file to analyze' },
        direction: { type: 'string', description: 'Direction of analysis: "imports" (what this file imports), "imported_by" (what imports this file), or "both"', enum: ['imports', 'imported_by', 'both'] },
        maxDepth: { type: 'number', description: 'Maximum depth for transitive dependencies (default 1, max 3)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'run_test_at',
    description: 'Run a specific test or test file. More targeted than run_command for test execution. Supports filtering by test name pattern.',
    parameters: {
      type: 'object',
      properties: {
        testPath: { type: 'string', description: 'Path to the test file or directory' },
        testNamePattern: { type: 'string', description: 'Optional: pattern to filter which tests to run (e.g., "should validate")' },
        runner: { type: 'string', description: 'Test runner to use. Defaults to auto-detect from project (vitest, jest, npm).', enum: ['auto', 'vitest', 'jest', 'npm', 'pytest', 'go-test'] },
      },
      required: ['testPath'],
    },
  },
  {
    name: 'write_memory',
    description: 'Write a note to the agent working memory (scratchpad). Use to record intermediate conclusions, todos, decisions, or facts you want to remember across tool calls.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The memory key (e.g., "todo_list", "architecture_decision", "bug_cause")' },
        value: { type: 'string', description: 'The value to store' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'read_memory',
    description: 'Read from the agent working memory. Retrieve previously stored notes to avoid re-discovering facts.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Optional: specific key to read. If omitted, returns all memory entries.' },
      },
      required: [],
    },
  },
  {
    name: 'undo_last_edit',
    description: 'Undo the last file write or edit operation. Restores the file to its previous content. Use this when you realize a change was incorrect.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_pending_edits',
    description: 'List all file edits that have been proposed but not yet applied. Use this to review pending changes before they are committed.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'apply_pending_edits',
    description: 'Apply all pending file edits that were held for review. After calling this, all proposed changes will be written to disk.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_documentation',
    description: 'Search for documentation and reference material. Use this to find API docs, library usage examples, or language references. Currently supports web search for documentation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query (e.g., "React useEffect cleanup", "TypeScript generics example")' },
        source: { type: 'string', description: 'Documentation source to search', enum: ['web', 'mdn', 'github'] },
        maxResults: { type: 'number', description: 'Maximum results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'plan_edits',
    description: 'Plan and apply multiple file edits atomically. All edits are validated before any are applied. If any edit fails validation (e.g., oldString not found), none are applied. Use this when a task requires coordinated changes across multiple files.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Path of the file to edit' },
              oldString: { type: 'string', description: 'The exact text to replace' },
              newString: { type: 'string', description: 'The replacement text' },
              replaceAll: { type: 'boolean', description: 'Replace all occurrences (default false)' },
            },
            required: ['filePath', 'oldString', 'newString'],
          },
          description: 'Array of edits to apply atomically',
        },
      },
      required: ['edits'],
    },
  },
];

// === Tool Executor ===

export interface ToolExecutionContext {
  workspacePath: string;
  openFiles?: { path: string; content: string }[];
  diagnostics?: { severity: string; message: string; file?: string; line?: number }[];
  onFileCreated?: (filePath: string, content: string) => void;
  onFileChanged?: (filePath: string, content: string) => void;
  previewFileWrites?: boolean;
  autoApplySafeEdits?: boolean;
  /** autoApplyFileWrites 由 codex 主流程使用，代表任务已通过 plan review，可直接落盘 */
  autoApplyFileWrites?: boolean;
  onFilePreview?: (filePath: string, content: string, existed: boolean, originalContent: string) => void;
  skills?: { id: string; name: string; description: string }[];
  mcpServers?: { id: string; name: string; tools: { name: string; description: string }[] }[];
  onCallMcpTool?: (serverId: string, toolName: string, args: Record<string, any>) => Promise<any>;
  onActivateSkill?: (skillId: string) => void;
  onGitCommand?: (command: string, args: string[]) => Promise<string>;
  onSearchCode?: (query: string, topK: number) => Promise<CodeSymbol[]>;
  teamRules?: string;
  /** Stream id used to isolate token-usage accounting per conversation. */
  streamId?: string;
  onAudit?: (actor: 'agent', action: string, target?: string, details?: Record<string, any>) => void;
  onTaskEvent?: (event: DevelopmentCommandEvent) => void;
  onRunCommand?: (
    request: DevelopmentCommandRequest,
    onEvent?: (event: DevelopmentCommandEvent) => void,
  ) => Promise<DevelopmentCommandResult & { history: DevelopmentCommandEvent[] }>;
  abortSignal?: AbortSignal;
  /** Agent working memory — persists across tool-call rounds within one run */
  scratchpad?: Scratchpad;
  /** Current Agent state (for tool-aware behavior) */
  agentState?: AgentStateSnapshot;
  /** Token budget event callback — tools can report estimated token cost */
  onTokenBudgetEvent?: (event: TokenBudgetEvent) => void;
  /** Pending file edits that haven't been applied yet (for review queue) */
  pendingEdits?: { filePath: string; content: string; existed: boolean; originalContent: string }[];
}

const MAX_SEARCH_RESULTS = 30;
/** 硬上限：read_file 单次读取的文件字节数，避免把超大文件整体载入内存 */
const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB
/** 未指定 endLine 时默认返回的最大行数，避免把超大文件灌满 Agent 上下文 */
const MAX_DEFAULT_READ_LINES = 2000;
const HIDDEN_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '__pycache__', '.next', 'coverage', '.vscode', '.idea', 'build', 'target']);

function resolvePath(inputPath: string, workspacePath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(workspacePath, inputPath);
}

/** 词法包含判定（parent 自身也算在内）；用 path.relative 避开 Windows 大小写不敏感场景下 startsWith 绕过 */
function isPathInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSafePath(filePath: string, workspacePath: string): boolean {
  const resolved = path.resolve(filePath);
  const normalizedWorkspace = path.resolve(workspacePath);
  // 第一关：词法路径必须在工作区内。
  if (!isPathInside(normalizedWorkspace, resolved)) return false;

  // 工作区本身可能是 symlink（子路径 realpath 会落在链接目标下），
  // 故以工作区的 realpath 作为第二关的基准。
  let realWorkspace = normalizedWorkspace;
  try { realWorkspace = fs.realpathSync(normalizedWorkspace); } catch { /* 保留词法形式 */ }

  // 用 lstat 判断路径本身是否存在（含断链 / 受限 symlink，existsSync 会跟随链接而误报 false）
  let exists = false;
  try { fs.lstatSync(resolved); exists = true; } catch { /* 路径不存在 */ }

  if (exists) {
    // 第二关：已存在的路径 realpath 失败即拒绝（受限环境宁可误杀，不可静默放行），
    // 解析成功则必须仍在工作区（realpath 形式）内，封死 symlink 逃逸。
    try {
      const real = fs.realpathSync(resolved);
      return isPathInside(realWorkspace, real);
    } catch {
      return false;
    }
  }

  // 路径尚不存在（新建文件）：对最深的已存在祖先做 realpath 校验，
  // 防止经由「工作区内指向外部的目录 symlink」创建越界文件。
  let cur = path.dirname(resolved);
  while (cur && cur !== path.dirname(cur)) {
    let ancestorExists = false;
    try { fs.lstatSync(cur); ancestorExists = true; } catch { /* 继续向上 */ }
    if (ancestorExists) {
      try {
        const realAncestor = fs.realpathSync(cur);
        return isPathInside(realWorkspace, realAncestor);
      } catch {
        return false;
      }
    }
    cur = path.dirname(cur);
  }
  return true;
}

export function isSensitivePath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  const sensitiveNames = ['.env', '.env.local', '.env.production', 'credentials', 'credentials.json', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'known_hosts', 'authorized_keys'];
  if (sensitiveNames.includes(base)) return true;
  if (/\.(pem|key|pfx|p12|keystore|jks)$/i.test(base)) return true;
  // 不要误删 .git 内部对象
  if (filePath.split(/[\\/]/).includes('.git')) return true;
  return false;
}

/**
 * 破坏性操作（删除 / 重命名）的安全门：
 * - 敏感文件（密钥、.env、.git 等）一律拒绝；
 * - 否则仅在「自动应用」或调用方显式 confirm 时才真正执行，
 *   否则返回待确认提案，强制人工确认，避免 Agent 误删。
 */
export function destructiveAllowed(args: any, context: ToolExecutionContext): boolean {
  return context.autoApplyFileWrites === true || args.confirm === true;
}

export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolExecutionContext
): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  let args: Record<string, any> = {};

  try {
    args = JSON.parse(argsStr || '{}');
  } catch {
    return `Error: Invalid JSON arguments: ${argsStr}`;
  }

  context.onAudit?.(
    'agent',
    `tool:${name}`,
    args.filePath || args.path || args.command || args.query || args.pattern,
    { args: argsStr }
  );

  try {
    switch (name) {
      case 'read_file':
        return executeReadFile(args, context);
      case 'write_file':
        return executeWriteFile(args, context);
      case 'edit_file':
        return executeEditFile(args, context);
      case 'search_code':
        return executeSearchCode(args, context);
      case 'list_files':
        return executeListFiles(args, context);
      case 'run_command':
        return await executeRunCommand(args, context);
      case 'get_diagnostics':
        return executeGetDiagnostics(args, context);
      case 'read_lints':
        return executeReadLints(args, context);
      case 'create_directory':
        return executeCreateDirectory(args, context);
      case 'delete_file':
        return executeDeleteFile(args, context);
      case 'rename_file':
        return executeRenameFile(args, context);
      case 'git_status':
        return await executeGitStatus(context);
      case 'git_diff':
        return await executeGitDiff(args, context);
      case 'git_commit':
        return await executeGitCommit(args, context);
      case 'list_skills':
        return executeListSkills(context);
      case 'use_skill':
        return executeUseSkill(args, context);
      case 'list_mcp_tools':
        return executeListMcpTools(context);
      case 'call_mcp_tool':
        return await executeCallMcpTool(args, context);
      case 'create_checkpoint':
        return executeCreateCheckpoint(args, context);
      case 'restore_checkpoint':
        return executeRestoreCheckpoint(args, context);
      case 'analyze_dependencies':
        return await executeAnalyzeDependencies(args, context);
      case 'run_test_at':
        return await executeRunTestAt(args, context);
      case 'write_memory':
        return executeWriteMemory(args, context);
      case 'read_memory':
        return executeReadMemory(args, context);
      case 'undo_last_edit':
        return executeUndoLastEdit(context);
      case 'list_pending_edits':
        return executeListPendingEdits(context);
      case 'apply_pending_edits':
        return executeApplyPendingEdits(context);
      case 'search_documentation':
        return await executeSearchDocumentation(args, context);
      case 'plan_edits':
        return executePlanEdits(args, context);
      default:
        return `Error: Unknown tool "${name}"`;
    }
  } catch (e: any) {
    return `Error executing ${name}: ${e.message}`;
  }
}

function executeReadFile(args: any, context: ToolExecutionContext): string {
  const filePath = resolvePath(args.filePath, context.workspacePath);

  if (!isSafePath(filePath, context.workspacePath)) {
    return `Error: Cannot read path outside workspace: ${filePath}`;
  }

  // Check open files first
  if (context.openFiles) {
    const openFile = context.openFiles.find(f => f.path === filePath);
    if (openFile) {
      const lines = openFile.content.split('\n');
      const start = (args.startLine || 1) - 1;
      const end = args.endLine ? args.endLine : lines.length;
      const selectedLines = lines.slice(start, end);
      return `File: ${filePath} (from editor buffer)\nLines ${start + 1}-${Math.min(end, lines.length)}:\n\`\`\`\n${selectedLines.map((l, i) => `${start + i + 1}| ${l}`).join('\n')}\n\`\`\``;
    }
  }

  if (!fs.existsSync(filePath)) {
    return `Error: File not found: ${filePath}`;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return `Error: "${filePath}" is a directory. Use list_files instead.`;
  }
  if (stat.size > MAX_READ_BYTES) {
    return `Error: File is too large to read (${(stat.size / 1024 / 1024).toFixed(1)} MB > ${MAX_READ_BYTES / 1024 / 1024} MB cap). Read it in smaller chunks using startLine/endLine.`;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const start = (args.startLine || 1) - 1;
  const totalLines = lines.length;
  let end = args.endLine ? args.endLine : totalLines;
  let truncated = false;
  if (!args.endLine && end > MAX_DEFAULT_READ_LINES) {
    end = MAX_DEFAULT_READ_LINES;
    truncated = true;
  }
  const selectedLines = lines.slice(start, end);
  const note = truncated
    ? `\n(Showing first ${MAX_DEFAULT_READ_LINES} of ${totalLines} lines. Use startLine/endLine to read more.)`
    : '';
  
  return `File: ${filePath} (${totalLines} lines total)\nLines ${start + 1}-${Math.min(end, totalLines)}:\n\`\`\`\n${selectedLines.map((l, i) => `${start + i + 1}| ${l}`).join('\n')}\n\`\`\`${note}`;
}

function isSafeWrite(args: any, existed: boolean): boolean {
  // New files are considered safe to create automatically.
  if (!existed) return true;
  return false;
}

function isSafeEdit(args: any): boolean {
  // Simple single-line edits with small strings are considered safe.
  const oldString = String(args.oldString || '');
  const newString = String(args.newString || '');
  if (args.replaceAll === true) return false;
  if (oldString.split('\n').length > 1 || newString.split('\n').length > 1) return false;
  if (oldString.length > 200 || newString.length > 200) return false;
  return true;
}

function executeWriteFile(args: any, context: ToolExecutionContext): string {
  const filePath = resolvePath(args.filePath, context.workspacePath);

  if (!isSafePath(filePath, context.workspacePath)) {
    return `Error: Cannot write to path outside workspace: ${filePath}`;
  }

  // 敏感路径（密钥 / .env / .git 内部）一律拒绝写入——无论新建还是覆盖。
  // 新建 .git/hooks/* 或写 .git/config 可造成命令执行（RCE），必须在落盘前拦截。
  if (isSensitivePath(filePath)) {
    return `Error: Refusing to write to a sensitive path: ${filePath}. Edit it manually if intended.`;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(filePath);
  const originalContent = existed ? fs.readFileSync(filePath, 'utf-8') : '';
  const safe = context.autoApplySafeEdits && isSafeWrite(args, existed);

  if (context.previewFileWrites && !safe && !context.autoApplyFileWrites) {
    // Add to pending edits queue for review
    if (!context.pendingEdits) context.pendingEdits = [];
    context.pendingEdits.push({ filePath, content: args.content, existed, originalContent });
    context.onFilePreview?.(filePath, args.content, existed, originalContent);
    return `Proposed write of ${args.content.split('\n').length} lines to ${filePath}. Review the diff before applying. ${context.pendingEdits.length} edit(s) pending.`;
  }

  // Atomic write: temp + rename avoids a truncated file on crash.
  const writeDir = path.dirname(filePath);
  const tmpFile = path.join(writeDir, `.loom-agent-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(tmpFile, args.content, 'utf-8');
  fs.renameSync(tmpFile, filePath);

  if (existed) {
    context.onFileChanged?.(filePath, args.content);
  } else {
    context.onFileCreated?.(filePath, args.content);
  }

  return `Successfully wrote ${args.content.split('\n').length} lines to ${filePath}`;
}

function executeEditFile(args: any, context: ToolExecutionContext): string {
  const filePath = resolvePath(args.filePath, context.workspacePath);

  if (!isSafePath(filePath, context.workspacePath)) {
    return `Error: Cannot edit file outside workspace: ${filePath}`;
  }

  // 敏感路径（密钥 / .env / .git 内部）一律拒绝编辑，避免改写 .git/config 等造成 RCE。
  if (isSensitivePath(filePath)) {
    return `Error: Refusing to edit a sensitive path: ${filePath}. Edit it manually if intended.`;
  }

  if (!fs.existsSync(filePath)) {
    // Enhanced error recovery: suggest similar files
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath);
    let suggestion = '';
    try {
      const entries = fs.readdirSync(dir);
      const similar = entries.find(e => e.includes(baseName) || baseName.includes(e));
      if (similar) suggestion = ` Did you mean "${similar}"?`;
    } catch { /* skip */ }
    return `Error: File not found: ${filePath}.${suggestion} Use list_files to explore the directory.`;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const replaceAll = args.replaceAll === true;
  const safe = context.autoApplySafeEdits && isSafeEdit(args);

  // 单一替换逻辑：兼容 CRLF / LF 差异，replaceAll 走 split+join，否则走 String.replace
  const { newContent, matched } = applyReplacement(content, args.oldString, args.newString, replaceAll);
  if (!matched) {
    // Enhanced error recovery: provide context about what's in the file
    const snippet = content.split('\n').slice(0, 20).map((l, i) => `  ${i + 1}| ${l}`).join('\n');
    return `Error: Could not find the exact text to replace in ${filePath}.\n` +
      `The old_string must match exactly (including whitespace).\n` +
      `File starts with:\n${snippet}\n` +
      `Tip: Use read_file first to see the exact content, then copy the exact text for old_string.`;
  }

  if (context.previewFileWrites && !safe && !context.autoApplyFileWrites) {
    // Add to pending edits queue for review
    if (!context.pendingEdits) context.pendingEdits = [];
    context.pendingEdits.push({ filePath, content: newContent, existed: true, originalContent: content });
    context.onFilePreview?.(filePath, newContent, true, content);
    return `Proposed edit to ${filePath}. Review the diff before applying. ${context.pendingEdits.length} edit(s) pending.`;
  }

  // Atomic write: temp + rename avoids a truncated file on crash.
  const writeDir = path.dirname(filePath);
  const tmpFile = path.join(writeDir, `.loom-agent-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(tmpFile, newContent, 'utf-8');
  fs.renameSync(tmpFile, filePath);
  context.onFileChanged?.(filePath, fs.readFileSync(filePath, 'utf-8'));
  return `Successfully edited ${filePath}`;
}

/**
 * 统一的内容替换实现。自动处理 CRLF/LF 差异，并支持 replaceAll。
 * 返回 { newContent, matched }：matched=false 表示未找到 oldString。
 */
function applyReplacement(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): { newContent: string; matched: boolean } {
  if (content.includes(oldString)) {
    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);
    return { newContent, matched: true };
  }
  // 退化：尝试统一换行符
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const normalizedOld = oldString.replace(/\r\n/g, '\n');
  const normalizedNew = newString.replace(/\r\n/g, '\n');
  if (!normalizedContent.includes(normalizedOld)) {
    return { newContent: content, matched: false };
  }
  const newContent = replaceAll
    ? normalizedContent.split(normalizedOld).join(normalizedNew)
    : normalizedContent.replace(normalizedOld, normalizedNew);
  return { newContent, matched: true };
}

async function executeSearchCode(args: any, context: ToolExecutionContext): Promise<string> {
  // Prefer semantic code index search when available and a natural-language query is provided.
  const query = args.query || args.pattern;
  if (!query) {
    return 'Error: search_code requires either a "query" (semantic) or "pattern" (grep) argument.';
  }

  if (context.onSearchCode && args.query) {
    try {
      const results = await context.onSearchCode(args.query, args.topK || 10);
      if (!results || results.length === 0) {
        return `No code symbols found for "${args.query}"`;
      }
      let output = `Found ${results.length} code symbols for "${args.query}":\n\n`;
      for (const r of results) {
        output += `• ${r.kind} ${r.name} in ${path.relative(context.workspacePath, r.filePath)}:${r.startLine}\n`;
        if (r.docs) output += `  Docs: ${r.docs.split('\n')[0].slice(0, 120)}\n`;
        output += `  ${r.text.split('\n').slice(0, 3).join('\n  ').slice(0, 300)}\n\n`;
      }
      return output;
    } catch (e: any) {
      // Fall through to grep search if code index fails
    }
  }

  const pattern = query;
  const fileTypes = args.fileTypes ? args.fileTypes.split(',').map((s: string) => s.trim()) : null;
  const maxResults = args.maxResults || MAX_SEARCH_RESULTS;
  const caseSensitive = args.caseSensitive || false;
  const useRegex = args.useRegex || false;

  let regex: RegExp | null = null;
  if (useRegex) {
    try {
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return `Error: Invalid regex pattern: ${pattern}`;
    }
  }

  const results: { file: string; line: number; content: string }[] = [];
  let searched = 0;
  const binaryExts = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.png', '.jpg', '.gif', '.ico', '.zip', '.tar', '.gz', '.pdf']);

  // Async recursive scan — yields to the event loop every YIELD_EVERY files
  // so a large workspace doesn't block IPC / streaming for seconds at a time.
  const YIELD_EVERY = 50;
  async function searchDir(dir: string, depth: number): Promise<void> {
    if (depth > 8 || results.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip inaccessible directories
    }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (HIDDEN_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await searchDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (fileTypes && !fileTypes.some((ext: string) => entry.name.endsWith(ext))) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (binaryExts.has(ext)) continue;

        try {
          const fstat = await fsPromises.stat(fullPath);
          if (fstat.size > MAX_READ_BYTES) continue; // 跳过超大文件，避免整体载入内存
          searched++;
          const content = await fsPromises.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            let matched = false;
            if (regex) {
              regex.lastIndex = 0;
              matched = regex.test(lines[i]);
            } else {
              const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
              const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
              matched = line.includes(searchPattern);
            }
            if (matched) {
              results.push({
                file: path.relative(context.workspacePath, fullPath),
                line: i + 1,
                content: lines[i].trim().substring(0, 200),
              });
              if (results.length >= maxResults) break;
            }
          }
        } catch {
          // Skip unreadable files
        }
        // Yield periodically to keep the main process responsive.
        if (searched % YIELD_EVERY === 0) await yieldToEventLoop();
      }
    }
  }

  await searchDir(context.workspacePath, 0);

  if (results.length === 0) {
    return `No results found for "${pattern}" (searched ${searched} files)`;
  }

  const grouped: Record<string, typeof results> = {};
  for (const r of results) {
    if (!grouped[r.file]) grouped[r.file] = [];
    grouped[r.file].push(r);
  }

  let output = `Found ${results.length} results for "${pattern}" in ${Object.keys(grouped).length} files (searched ${searched} files):\n\n`;
  for (const [file, matches] of Object.entries(grouped)) {
    output += `📄 ${file} (${matches.length} matches):\n`;
    for (const m of matches.slice(0, 5)) {
      output += `  ${m.line}: ${m.content}\n`;
    }
    if (matches.length > 5) output += `  ... and ${matches.length - 5} more matches\n`;
    output += '\n';
  }
  
  return output;
}

function executeListFiles(args: any, context: ToolExecutionContext): string {
  const dirPath = resolvePath(args.dirPath, context.workspacePath);

  if (!isSafePath(dirPath, context.workspacePath)) {
    return `Error: Cannot list path outside workspace: ${dirPath}`;
  }

  const maxDepth = Math.min(args.depth || 1, 3);

  if (!fs.existsSync(dirPath)) {
    return `Error: Directory not found: ${dirPath}`;
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return `Error: "${dirPath}" is not a directory`;
  }

  const output: string[] = [];
  let fileCount = 0;
  let dirCount = 0;

  function listDir(dir: string, depth: number, prefix: string) {
    if (depth > maxDepth || fileCount + dirCount > 200) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // Sort: directories first, then alphabetical
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (HIDDEN_DIRS.has(entry.name) && depth === 0 && entry.isDirectory()) continue;
        
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = prefix + (isLast ? '    ' : '│   ');

        if (entry.isDirectory()) {
          dirCount++;
          output.push(`${prefix}${connector}📁 ${entry.name}/`);
          listDir(path.join(dir, entry.name), depth + 1, childPrefix);
        } else {
          fileCount++;
          output.push(`${prefix}${connector}📄 ${entry.name}`);
        }
      }
    } catch {
      output.push(`${prefix}[Permission denied]`);
    }
  }

  const displayPath = path.relative(context.workspacePath, dirPath) || '.';
  output.push(`📂 ${displayPath}/`);
  listDir(dirPath, 1, '');

  const summary = `\n${dirCount} directories, ${fileCount} files`;
  return output.join('\n') + summary;
}

// The allowed/blocked command policy is now centralised in
// `src/main/command-policy.ts` and enforced inside `development-command.ts`
// (`validateDevelopmentCommandRequest`). The local hard-coded ALLOWED/BLOCKED
// sets that used to live here were duplicated and got out of sync — they have
// been removed in favour of the single source of truth.

async function executeRunCommand(args: any, context: ToolExecutionContext): Promise<string> {
  const cwd = args.cwd ? resolvePath(args.cwd, context.workspacePath) : context.workspacePath;

  if (!isSafePath(cwd, context.workspacePath)) {
    return `Error: Working directory is outside workspace: ${cwd}`;
  }

  const command = String(args.command || '').trim();
  if (!command) {
    return 'Error: command is required';
  }

  const cmdArgs: string[] = Array.isArray(args.args)
    ? args.args.map((a: any) => String(a))
    : [];

  try {
    const runCommand = context.onRunCommand || runDevelopmentCommandStreaming;
    const result = await runCommand({
      command,
      args: cmdArgs,
      cwd,
      workspacePath: context.workspacePath,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 120000,
      retryCount: typeof args.retryCount === 'number' ? args.retryCount : 0,
      abortSignal: context.abortSignal,
    }, context.onTaskEvent);

    const stdout = result.stdout;
    const stderr = result.stderr;

    if (result.error) {
      return `Error: ${result.error}`;
    }

    if (result.exitCode !== 0) {
      let errorMsg = `Command failed with exit code ${result.exitCode ?? 'unknown'}`;
      if (stderr) errorMsg += `\nStderr: ${stderr.substring(0, 1000)}`;
      if (stdout) errorMsg += `\nStdout: ${stdout.substring(0, 1000)}`;
      return errorMsg;
    }

    if (!stdout && !stderr) return `Command executed successfully (no output)`;
    return (stdout + (stderr ? '\n' + stderr : '')).substring(0, 5000);
  } catch (e: any) {
    return `Error executing command: ${e.message}`;
  }
}

const CHECKPOINT_IGNORE = new Set(['node_modules', '.git', 'dist', 'coverage', '.loom']);

function listFilesForCheckpoint(dir: string, files: string[]) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (CHECKPOINT_IGNORE.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        listFilesForCheckpoint(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss', '.html', '.py', '.rs', '.go', '.java'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // ignore
  }
}

function executeCreateCheckpoint(args: any, context: ToolExecutionContext): string {
  const label = args.label ? `-${args.label.replace(/[^a-z0-9_-]/gi, '_')}` : '';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Try git stash first
  try {
    const gitDir = path.join(context.workspacePath, '.git');
    if (fs.existsSync(gitDir)) {
      const stashMessage = `loom-checkpoint${label}-${timestamp}`;
      const result = spawnSync('git', ['stash', 'push', '-m', stashMessage], {
        cwd: context.workspacePath,
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
        shell: false,
      });
      if (result.status === 0) {
        return `Git checkpoint created: ${stashMessage}`;
      }
      // If stash failed (e.g. no changes), fall through to file backup
    }
  } catch {
    // fall through
  }

  // File-based backup
  try {
    const checkpointDir = path.join(context.workspacePath, '.loom', 'checkpoints', `checkpoint${label}-${timestamp}`);
    fs.mkdirSync(checkpointDir, { recursive: true });
    const files: string[] = [];
    listFilesForCheckpoint(context.workspacePath, files);
    for (const filePath of files) {
      const relative = path.relative(context.workspacePath, filePath);
      const dest = path.join(checkpointDir, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(filePath, dest);
    }
    return `File checkpoint created at ${checkpointDir} (${files.length} files backed up)`;
  } catch (e: any) {
    return `Error creating checkpoint: ${e.message}`;
  }
}

function executeRestoreCheckpoint(args: any, context: ToolExecutionContext): string {
  // Try git stash pop first
  try {
    const gitDir = path.join(context.workspacePath, '.git');
    if (fs.existsSync(gitDir)) {
      const result = spawnSync('git', ['stash', 'pop'], {
        cwd: context.workspacePath,
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
        shell: false,
      });
      if (result.status === 0) return 'Restored to previous git checkpoint (stash pop)';
    }
  } catch {
    // fall through
  }

  // File-based restore: find the latest checkpoint
  try {
    const checkpointsDir = path.join(context.workspacePath, '.loom', 'checkpoints');
    if (!fs.existsSync(checkpointsDir)) return 'No checkpoint found';
    const entries = fs.readdirSync(checkpointsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
    if (entries.length === 0) return 'No checkpoint found';
    const latest = path.join(checkpointsDir, entries[entries.length - 1]);

    function restoreDir(srcDir: string, destRoot: string) {
      const items = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const item of items) {
        const src = path.join(srcDir, item.name);
        if (item.isDirectory()) {
          restoreDir(src, path.join(destRoot, item.name));
        } else {
          const dest = path.join(destRoot, item.name);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
    }
    restoreDir(latest, context.workspacePath);
    return `Restored from file checkpoint: ${latest}`;
  } catch (e: any) {
    return `Error restoring checkpoint: ${e.message}`;
  }
}

function executeGetDiagnostics(args: any, context: ToolExecutionContext): string {
  const diags = context.diagnostics || [];
  if (diags.length === 0) {
    return 'No diagnostics found. The code appears to be clean! ✨';
  }

  const filePath = args.filePath;
  const filtered = filePath ? diags.filter(d => d.file === filePath || d.file?.endsWith(filePath)) : diags;

  if (filtered.length === 0) {
    return `No diagnostics found for ${filePath || 'any files'}.`;
  }

  const errors = filtered.filter(d => d.severity === 'error');
  const warnings = filtered.filter(d => d.severity === 'warning');
  const infos = filtered.filter(d => d.severity === 'info');

  let output = `Diagnostics: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info\n\n`;
  
  if (errors.length > 0) {
    output += `❌ Errors:\n`;
    for (const e of errors.slice(0, 10)) {
      output += `  ${e.file || ''}${e.line ? `:${e.line}` : ''} - ${e.message}\n`;
    }
    output += '\n';
  }
  if (warnings.length > 0) {
    output += `⚠️ Warnings:\n`;
    for (const w of warnings.slice(0, 10)) {
      output += `  ${w.file || ''}${w.line ? `:${w.line}` : ''} - ${w.message}\n`;
    }
    output += '\n';
  }
  
  return output;
}

function executeReadLints(args: any, context: ToolExecutionContext): string {
  const targetPath = args.paths ? resolvePath(args.paths, context.workspacePath) : context.workspacePath;

  if (!fs.existsSync(targetPath)) {
    return `Error: Path not found: ${targetPath}`;
  }

  // Use tsc for TypeScript projects, eslint for JS projects
  try {
    let result = '';
    // Check if there's a tsconfig.json
    if (fs.existsSync(path.join(context.workspacePath, 'tsconfig.json'))) {
      const tscResult = spawnSync('npx', ['tsc', '--noEmit', '--pretty'], {
        cwd: context.workspacePath,
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        shell: false,
      });
      result = (tscResult.stdout || '') + (tscResult.stderr || '');
    }
    if (!result || result.includes('No inputs were found')) {
      return 'No linter configuration found or no issues detected.';
    }
    return result.substring(0, 5000);
  } catch (e: any) {
    // Unexpected error during lint execution
    return `Lint error: ${e.message || 'Unknown error'}`;
  }
}

function executeCreateDirectory(args: any, context: ToolExecutionContext): string {
  const dirPath = resolvePath(args.dirPath, context.workspacePath);
  
  if (!isSafePath(dirPath, context.workspacePath)) {
    return `Error: Cannot create directory outside workspace: ${dirPath}`;
  }

  try {
    if (fs.existsSync(dirPath)) {
      return `Directory already exists: ${dirPath}`;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    return `Successfully created directory: ${dirPath}`;
  } catch (e: any) {
    return `Error creating directory: ${e.message}`;
  }
}

function executeDeleteFile(args: any, context: ToolExecutionContext): string {
  const filePath = resolvePath(args.filePath, context.workspacePath);

  if (!isSafePath(filePath, context.workspacePath)) {
    return `Error: Cannot delete path outside workspace: ${filePath}`;
  }

  if (isSensitivePath(filePath)) {
    return `Error: Refusing to delete a sensitive path: ${filePath}. Delete it manually if intended.`;
  }

  if (!fs.existsSync(filePath)) {
    return `Error: Path not found: ${filePath}`;
  }

  // 破坏性操作需要人工确认（autoApplyFileWrites / confirm 才真正执行）
  if (!destructiveAllowed(args, context)) {
    return `Proposed delete of ${filePath}. This is destructive — re-issue the call with confirm: true to apply.`;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
      return `Successfully deleted directory: ${filePath}`;
    } else {
      fs.unlinkSync(filePath);
      return `Successfully deleted file: ${filePath}`;
    }
  } catch (e: any) {
    return `Error deleting path: ${e.message}`;
  }
}

function executeRenameFile(args: any, context: ToolExecutionContext): string {
  const oldPath = resolvePath(args.oldPath, context.workspacePath);
  const newPath = resolvePath(args.newPath, context.workspacePath);

  if (!isSafePath(oldPath, context.workspacePath) || !isSafePath(newPath, context.workspacePath)) {
    return `Error: Cannot rename paths outside workspace`;
  }

  if (isSensitivePath(oldPath) || isSensitivePath(newPath)) {
    return `Error: Refusing to rename a sensitive path (${oldPath} -> ${newPath}).`;
  }

  if (!fs.existsSync(oldPath)) {
    return `Error: Source path not found: ${oldPath}`;
  }

  if (fs.existsSync(newPath)) {
    return `Error: Destination already exists: ${newPath}`;
  }

  if (!destructiveAllowed(args, context)) {
    return `Proposed rename of ${oldPath} to ${newPath}. This is destructive — re-issue the call with confirm: true to apply.`;
  }

  try {
    const destDir = path.dirname(newPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.renameSync(oldPath, newPath);
    return `Successfully renamed ${oldPath} to ${newPath}`;
  } catch (e: any) {
    return `Error renaming: ${e.message}`;
  }
}

async function executeGitStatus(context: ToolExecutionContext): Promise<string> {
  if (!context.onGitCommand) {
    return 'Error: Git integration not available';
  }

  try {
    const status = await context.onGitCommand('status', ['--porcelain']);
    const branch = await context.onGitCommand('branch', ['--show-current']);
    const changes = status.split('\n').filter(Boolean);
    
    let output = `Branch: ${branch}\n\n`;
    if (changes.length === 0) {
      output += 'No changes detected.';
    } else {
      output += `Changes (${changes.length} files):\n`;
    for (const change of changes.slice(0, 50)) {
      const rawStatus = change.substring(0, 2);
      const file = change.substring(3).trim();
      const idx = rawStatus[0] || ' ';
      const wt = rawStatus[1] || ' ';
      const statusIcon = idx === 'M' || wt === 'M' ? '📝' : idx === 'A' || wt === 'A' ? '➕' : idx === 'D' || wt === 'D' ? '❌' : idx === '?' || wt === '?' ? '❓' : '❓';
      output += `  ${statusIcon} ${rawStatus} ${file}\n`;
    }
    }
    
    return output;
  } catch (e: any) {
    return `Git error: ${e.message}`;
  }
}

async function executeGitDiff(args: any, context: ToolExecutionContext): Promise<string> {
  if (!context.onGitCommand) {
    return 'Error: Git integration not available';
  }

  try {
    const diffArgs = ['diff'];
    if (args.filePath) {
      diffArgs.push('--', args.filePath);
    }
    const diff = await context.onGitCommand('diff', diffArgs);
    
    if (!diff) {
      return 'No changes detected.';
    }
    
    return diff.substring(0, 10000);
  } catch (e: any) {
    return `Git error: ${e.message}`;
  }
}

async function executeGitCommit(args: any, context: ToolExecutionContext): Promise<string> {
  if (!context.onGitCommand) {
    return 'Error: Git integration not available';
  }

  try {
    await context.onGitCommand('add', ['-A']);
    const result = await context.onGitCommand('commit', ['-m', args.message]);
    return `Commit successful:\n${result}`;
  } catch (e: any) {
    return `Git commit error: ${e.message}`;
  }
}

function executeListSkills(context: ToolExecutionContext): string {
  const skills = context.skills || [];
  
  if (skills.length === 0) {
    return 'No skills available. Skills can be configured in Settings > Skills.';
  }
  
  let output = `Available Skills (${skills.length}):\n\n`;
  for (const skill of skills) {
    output += `🎯 ${skill.name} (${skill.id})\n`;
    output += `   ${skill.description}\n\n`;
  }
  
  output += '\nUse the "use_skill" tool to activate a specific skill.';
  return output;
}

function executeUseSkill(args: any, context: ToolExecutionContext): string {
  const skillId = args.skillId;
  const skills = context.skills || [];
  const skill = skills.find(s => s.id === skillId);
  
  if (!skill) {
    return `Error: Skill "${skillId}" not found. Use "list_skills" to see available skills.`;
  }
  
  if (context.onActivateSkill) {
    context.onActivateSkill(skillId);
    return `Activated skill: ${skill.name}\n${skill.description}`;
  }
  
  return `Skill "${skill.name}" is available but activation handler not configured.`;
}

function executeListMcpTools(context: ToolExecutionContext): string {
  const servers = context.mcpServers || [];
  
  if (servers.length === 0) {
    return 'No MCP servers connected. Configure MCP servers in Settings > MCP.';
  }
  
  let output = `MCP Servers and Tools:\n\n`;
  
  for (const server of servers) {
    output += `🖥️ Server: ${server.name} (${server.id})\n`;
    if (server.tools.length === 0) {
      output += '   No tools available\n';
    } else {
      for (const tool of server.tools) {
        output += `   🔧 ${tool.name}: ${tool.description}\n`;
      }
    }
    output += '\n';
  }
  
  return output;
}

async function executeCallMcpTool(args: any, context: ToolExecutionContext): Promise<string> {
  if (!context.onCallMcpTool) {
    return 'Error: MCP integration not available';
  }

  const { serverId, toolName, args: toolArgs } = args;

  try {
    const result = await context.onCallMcpTool(serverId, toolName, toolArgs || {});
    return `MCP tool result:\n${JSON.stringify(result, null, 2)}`;
  } catch (e: any) {
    return `MCP tool error: ${e.message}`;
  }
}

/**
 * Format tool definitions for the AI system prompt
 */
export function getToolSystemPrompt(): string {
  let prompt = `\n\nYou have access to the following tools to read, write, edit, and analyze code in the user's project:\n\n`;

  for (const tool of AGENT_TOOLS) {
    prompt += `### ${tool.name}\n${tool.description}\n`;
    if (tool.parameters.required.length > 0) {
      prompt += `Required: ${tool.parameters.required.join(', ')}\n`;
    }
    prompt += `Parameters: ${JSON.stringify(tool.parameters.properties)}\n\n`;
  }

  prompt += `\n## Tool Usage Examples

### Reading a file
\`\`\`tool_call
{"name": "read_file", "arguments": {"filePath": "src/index.ts"}}
\`\`\`

### Editing a file (REPLACE old code with new code)
\`\`\`tool_call
{"name": "edit_file", "arguments": {"filePath": "src/index.ts", "oldString": "const old = 1;", "newString": "const new = 2;"}}
\`\`\`

### Adding new code (use empty oldString to insert at beginning, or find a nearby line to replace)
\`\`\`tool_call
{"name": "edit_file", "arguments": {"filePath": "src/index.ts", "oldString": "// existing line", "newString": "// new line to add\\n// existing line"}}
\`\`\`

### Writing a new file
\`\`\`tool_call
{"name": "write_file", "arguments": {"filePath": "src/newfile.ts", "content": "// file content"}}
\`\`\`

### Searching code
\`\`\`tool_call
{"name": "search_code", "arguments": {"pattern": "function_name", "fileTypes": ".ts,.tsx"}}
\`\`\`

### Running a command
\`\`\`tool_call
{"name": "run_command", "arguments": {"command": "npm", "args": ["test"]}}
\`\`\`

## Important Rules
1. Always read files before editing them to understand the current content
2. Always search before making assumptions about the codebase
3. When editing files, make sure the oldString matches EXACTLY what's in the file (including whitespace and indentation)
4. To ADD new code, you MUST provide both oldString (existing code to anchor) and newString (old code + new code)
5. NEVER leave newString empty when you want to add code - that would DELETE the oldString
6. Use write_file for creating entirely new files, edit_file for modifying existing files
7. You can make multiple tool calls in sequence (they will execute in parallel)
8. After receiving tool results, continue responding to the user
9. Use write_memory/read_memory to maintain working memory across rounds
10. Use analyze_dependencies before making changes to understand impact
11. Use run_test_at to run specific tests after making changes
12. Use undo_last_edit to revert an incorrect change
13. Multiple tool calls in one turn execute in parallel for efficiency`;

  return prompt;
}

/**
 * Parse tool calls from AI response text
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Match ```tool_call ... ``` blocks
  const regex = /```tool_call\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      calls.push({
        id: 'call_' + Math.random().toString(36).substring(2, 10),
        type: 'function',
        function: {
          name: parsed.name,
          arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments),
        },
      });
    } catch (e) {
      // Try parsing as array
      try {
        const arr = JSON.parse(match[1].trim());
        if (Array.isArray(arr)) {
          for (const item of arr) {
            calls.push({
              id: 'call_' + Math.random().toString(36).substring(2, 10),
              type: 'function',
              function: {
                name: item.name,
                arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments),
              },
            });
          }
        }
      } catch {}
    }
  }
  
  return calls;
}

/**
 * Strip tool call blocks from AI response text for display
 */
export function stripToolCalls(text: string): string {
  return text.replace(/```tool_call\s*\n[\s\S]*?```/g, '').trim();
}

// === Enhanced Tool Implementations ===

async function executeAnalyzeDependencies(args: any, context: ToolExecutionContext): Promise<string> {
  const filePath = resolvePath(args.filePath, context.workspacePath);
  if (!isSafePath(filePath, context.workspacePath)) {
    return `Error: Cannot analyze path outside workspace: ${filePath}`;
  }
  if (!fs.existsSync(filePath)) {
    return `Error: File not found: ${filePath}`;
  }

  const direction = args.direction || 'both';
  const maxDepth = Math.min(args.maxDepth || 1, 3);
  const ext = path.extname(filePath).toLowerCase();

  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return `Error: Dependency analysis only supports JS/TS files`;
  }

  // Build import graph for the workspace (lightweight: scan imports only)
  const importRegex = /import\s+(?:{[^}]+}|[\w*]+)\s+from\s+['"]([^'"]+)['"]/g;
  const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|interface|type|async\s+function)\s+(\w+)/g;

  function getLocalImports(file: string): string[] {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const imports: string[] = [];
      let m;
      while ((m = importRegex.exec(content)) !== null) {
        const specifier = m[1];
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          imports.push(specifier);
        }
      }
      return imports;
    } catch {
      return [];
    }
  }

  function resolveImport(fromFile: string, specifier: string): string | null {
    const baseDir = path.dirname(fromFile);
    const candidates = [
      path.resolve(baseDir, specifier),
      path.resolve(baseDir, specifier + '.ts'),
      path.resolve(baseDir, specifier + '.tsx'),
      path.resolve(baseDir, specifier + '.js'),
      path.resolve(baseDir, specifier + '/index.ts'),
      path.resolve(baseDir, specifier + '/index.tsx'),
      path.resolve(baseDir, specifier + '/index.js'),
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  }

  const allFiles: string[] = [];
  function collectFiles(dir: string): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectFiles(full);
        else if (['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))) allFiles.push(full);
      }
    } catch { /* skip */ }
  }
  collectFiles(context.workspacePath);

  const resolvedFile = resolveImport(filePath, '.') || filePath;
  const lines: string[] = [];

  if (direction === 'imports' || direction === 'both') {
    const directImports = getLocalImports(resolvedFile);
    lines.push(`## Imports from ${path.relative(context.workspacePath, filePath)}`);
    if (directImports.length === 0) {
      lines.push('  (no local imports)');
    }
    for (const imp of directImports) {
      const resolved = resolveImport(resolvedFile, imp);
      lines.push(`  → ${imp}${resolved ? ` (${path.relative(context.workspacePath, resolved)})` : ' (unresolved)'}`);
      if (resolved && maxDepth > 1) {
        for (const subImp of getLocalImports(resolved)) {
          const subResolved = resolveImport(resolved, subImp);
          lines.push(`    → ${subImp}${subResolved ? ` (${path.relative(context.workspacePath, subResolved)})` : ''}`);
        }
      }
    }
  }

  if (direction === 'imported_by' || direction === 'both') {
    const importedBy: string[] = [];
    for (const f of allFiles) {
      if (f === resolvedFile) continue;
      const imports = getLocalImports(f);
      for (const imp of imports) {
        const resolved = resolveImport(f, imp);
        if (resolved === resolvedFile) {
          importedBy.push(f);
          break;
        }
      }
    }
    lines.push(`\n## Files importing ${path.relative(context.workspacePath, filePath)}`);
    if (importedBy.length === 0) {
      lines.push('  (no importers found)');
    }
    for (const f of importedBy.slice(0, 30)) {
      lines.push(`  ← ${path.relative(context.workspacePath, f)}`);
    }
    if (importedBy.length > 30) lines.push(`  ... and ${importedBy.length - 30} more`);
  }

  return lines.join('\n');
}

async function executeRunTestAt(args: any, context: ToolExecutionContext): Promise<string> {
  const testPath = resolvePath(args.testPath, context.workspacePath);
  if (!isSafePath(testPath, context.workspacePath)) {
    return `Error: Test path outside workspace: ${testPath}`;
  }
  if (!fs.existsSync(testPath)) {
    return `Error: Test path not found: ${testPath}`;
  }

  let runner = args.runner || 'auto';
  const pattern = args.testNamePattern || '';

  let command = '';
  let cmdArgs: string[] = [];

  if (runner === 'auto') {
    // Detect runner from project
    const hasVitest = fs.existsSync(path.join(context.workspacePath, 'vitest.config.ts')) ||
      fs.existsSync(path.join(context.workspacePath, 'vitest.config.js')) ||
      fs.existsSync(path.join(context.workspacePath, 'vite.config.ts'));
    const hasJest = fs.existsSync(path.join(context.workspacePath, 'jest.config.js')) ||
      fs.existsSync(path.join(context.workspacePath, 'jest.config.ts'));
    if (hasVitest) runner = 'vitest';
    else if (hasJest) runner = 'jest';
    else runner = 'npm';
  }

  switch (runner) {
    case 'vitest':
      command = 'npx';
      cmdArgs = ['vitest', 'run', testPath];
      if (pattern) cmdArgs.push('-t', pattern);
      break;
    case 'jest':
      command = 'npx';
      cmdArgs = ['jest', testPath];
      if (pattern) cmdArgs.push('-t', pattern);
      break;
    case 'npm':
      command = 'npm';
      cmdArgs = ['test', '--', testPath];
      if (pattern) cmdArgs.push('-t', pattern);
      break;
    case 'pytest':
      command = 'python3';
      cmdArgs = ['-m', 'pytest', testPath];
      if (pattern) cmdArgs.push('-k', pattern);
      break;
    case 'go-test':
      command = 'go';
      cmdArgs = ['test', testPath];
      if (pattern) cmdArgs.push('-run', pattern);
      break;
    default:
      command = 'npx';
      cmdArgs = ['vitest', 'run', testPath];
  }

  // Run via onRunCommand if available, else use spawnSync directly
  try {
    const runCommand = context.onRunCommand;
    if (runCommand) {
      const result = await runCommand({
        command,
        args: cmdArgs,
        cwd: context.workspacePath,
        workspacePath: context.workspacePath,
        timeoutMs: 180000,
        retryCount: 0,
        abortSignal: context.abortSignal,
      }, context.onTaskEvent);
      if (result.error) return `Test error: ${result.error}`;
      const output = `${result.stdout}\n${result.stderr}`.trim();
      return output.substring(0, 8000) || 'Tests completed (no output)';
    }
    // Fallback: spawnSync
    const result = spawnSync(command, cmdArgs, {
      cwd: context.workspacePath,
      encoding: 'utf-8',
      timeout: 180000,
      windowsHide: true,
      shell: false,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    return output.substring(0, 8000) || 'Tests completed (no output)';
  } catch (e: any) {
    return `Error running tests: ${e.message}`;
  }
}

function executeWriteMemory(args: any, context: ToolExecutionContext): string {
  if (!context.scratchpad) {
    return 'Error: Scratchpad not available. Memory operations require an active agent run.';
  }
  const key = String(args.key || '').trim();
  const value = String(args.value || '').trim();
  if (!key) return 'Error: key is required';
  if (!value) return 'Error: value is required';
  context.scratchpad.set(key, value);
  return `Stored "${key}" in working memory (${context.scratchpad.size} total entries)`;
}

function executeReadMemory(args: any, context: ToolExecutionContext): string {
  if (!context.scratchpad) {
    return 'Error: Scratchpad not available.';
  }
  const key = args.key ? String(args.key).trim() : '';
  if (key) {
    const value = context.scratchpad.get(key);
    return value !== undefined ? value : `No memory entry found for "${key}".`;
  }
  return context.scratchpad.summarize() || 'Working memory is empty.';
}

function executeUndoLastEdit(context: ToolExecutionContext): string {
  const pending = context.pendingEdits || [];
  if (pending.length === 0) {
    return 'No pending edits to undo.';
  }
  const last = pending.pop()!;
  if (last.existed) {
    // Restore original content
    try {
      fs.writeFileSync(last.filePath, last.originalContent, 'utf-8');
      context.onFileChanged?.(last.filePath, last.originalContent);
      return `Undid last edit to ${last.filePath} (restored original content)`;
    } catch (e: any) {
      return `Error undoing edit: ${e.message}`;
    }
  } else {
    // File was newly created, remove it
    try {
      if (fs.existsSync(last.filePath)) {
        fs.unlinkSync(last.filePath);
      }
      context.onFileChanged?.(last.filePath, '');
      return `Undid last edit to ${last.filePath} (removed newly created file)`;
    } catch (e: any) {
      return `Error removing file: ${e.message}`;
    }
  }
}

function executeListPendingEdits(context: ToolExecutionContext): string {
  const pending = context.pendingEdits || [];
  if (pending.length === 0) {
    return 'No pending edits. All changes have been applied.';
  }
  const lines = [`Pending Edits (${pending.length}):`];
  for (const edit of pending) {
    const status = edit.existed ? 'modified' : 'new';
    lines.push(`  • ${edit.filePath} (${status}, ${edit.content.split('\n').length} lines)`);
  }
  lines.push('\nUse "apply_pending_edits" to commit or "undo_last_edit" to revert.');
  return lines.join('\n');
}

function executeApplyPendingEdits(context: ToolExecutionContext): string {
  const pending = context.pendingEdits || [];
  if (pending.length === 0) {
    return 'No pending edits to apply.';
  }
  let applied = 0;
  for (const edit of pending) {
    try {
      fs.writeFileSync(edit.filePath, edit.content, 'utf-8');
      if (edit.existed) {
        context.onFileChanged?.(edit.filePath, edit.content);
      } else {
        context.onFileCreated?.(edit.filePath, edit.content);
      }
      applied++;
    } catch { /* skip failed writes */ }
  }
  const count = pending.length;
  pending.length = 0; // clear the queue
  return `Applied ${applied}/${count} pending edits.`;
}

async function executeSearchDocumentation(args: any, _context: ToolExecutionContext): Promise<string> {
  const query = String(args.query || '').trim();
  if (!query) return 'Error: query is required';
  const source = args.source || 'web';
  const maxResults = args.maxResults || 5;

  // Use DuckDuckGo instant answer API (free, no key required for basic queries)
  try {
    const url = source === 'mdn'
      ? `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US`
      : `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) {
      return `Documentation search returned HTTP ${resp.status}. Try searching manually.`;
    }

    const data = await resp.json() as any;

    if (source === 'mdn' && Array.isArray(data?.documents)) {
      const docs = data.documents.slice(0, maxResults);
      if (docs.length === 0) return `No MDN documentation found for "${query}".`;
      const lines = [`MDN Documentation for "${query}":`];
      for (const doc of docs) {
        lines.push(`  • ${doc.title}`);
        lines.push(`    ${doc.summary?.slice(0, 200) || ''}`);
        lines.push(`    https://developer.mozilla.org${doc.mdn_url}`);
      }
      return lines.join('\n');
    }

    // DuckDuckGo response
    const results: string[] = [];
    if (data.AbstractText) {
      results.push(`Summary: ${data.AbstractText}`);
    }
    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text) {
          results.push(`  • ${topic.Text}`);
          if (topic.FirstURL) results.push(`    ${topic.FirstURL}`);
        }
      }
    }
    if (results.length === 0) {
      return `No documentation found for "${query}". Try rephrasing your query.`;
    }
    return results.join('\n');
  } catch (e: any) {
    return `Documentation search failed: ${e.message}. Try searching the web directly.`;
  }
}

function executePlanEdits(args: any, context: ToolExecutionContext): string {
  const edits = args.edits;
  if (!Array.isArray(edits) || edits.length === 0) {
    return 'Error: edits array is required and must not be empty.';
  }

  if (edits.length > 20) {
    return 'Error: Maximum 20 edits per plan_edits call. Split into multiple calls if needed.';
  }

  // Phase 1: Validate all edits without applying
  const validatedEdits: { filePath: string; newContent: string; existed: boolean; originalContent: string }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const filePath = resolvePath(edit.filePath, context.workspacePath);

    if (!isSafePath(filePath, context.workspacePath)) {
      errors.push(`Edit ${i + 1}: Path outside workspace: ${edit.filePath}`);
      continue;
    }
    if (isSensitivePath(filePath)) {
      errors.push(`Edit ${i + 1}: Cannot edit sensitive path: ${edit.filePath}`);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      errors.push(`Edit ${i + 1}: File not found: ${edit.filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const replaceAll = edit.replaceAll === true;
    const { newContent, matched } = applyReplacement(content, edit.oldString, edit.newString, replaceAll);
    if (!matched) {
      errors.push(`Edit ${i + 1}: Could not find text in ${edit.filePath}. Use read_file to see exact content.`);
      continue;
    }

    validatedEdits.push({ filePath, newContent, existed: true, originalContent: content });
  }

  if (errors.length > 0) {
    return `Atomic edit validation failed — no edits applied:\n${errors.join('\n')}`;
  }

  // Phase 2: Apply all edits (all-or-nothing)
  const applied: string[] = [];
  try {
    for (const { filePath, newContent } of validatedEdits) {
      const writeDir = path.dirname(filePath);
      const tmpFile = path.join(writeDir, `.loom-agent-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      fs.writeFileSync(tmpFile, newContent, 'utf-8');
      fs.renameSync(tmpFile, filePath);
      context.onFileChanged?.(filePath, newContent);
      applied.push(filePath);
    }
  } catch (e: any) {
    // Attempt rollback for already-applied edits
    // Note: In a production system, we'd save backups before applying
    return `Error during atomic apply: ${e.message}. ${applied.length} files were modified before the error.`;
  }

  return `Successfully applied ${applied.length} atomic edit(s):\n${applied.map(f => `  ✓ ${f}`).join('\n')}`;
}
