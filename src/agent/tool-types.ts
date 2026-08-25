import type { CodeSymbol } from './code-index';
import type { Scratchpad } from './scratchpad';
import type { AgentStateSnapshot } from './agent-state-machine';
import type { TokenBudgetEvent } from './token-budget';
import type {
  DevelopmentCommandEvent,
  DevelopmentCommandRequest,
  DevelopmentCommandResult,
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
    name: 'git_stage',
    description: 'Stage specific files for commit. You must stage files explicitly before git_commit — git_commit only commits already-staged changes and refuses to auto-stage. Inspect git_status/git_diff first, then stage exactly the files the user wants in the commit.',
    parameters: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Relative or absolute paths of files to stage (workspace-scoped).' },
      },
      required: ['files'],
    },
  },
  {
    name: 'git_commit',
    description: 'Create a git commit with the provided message. Only commits changes that were explicitly staged with git_stage. If the staging area is empty the call fails — run git_stage first.',
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
  /**
   * Real user approval gate for destructive operations (delete_file /
   * rename_file). When set, the tool BLOCKS until the user approves or
   * rejects — the model can no longer self-confirm destructive actions.
   */
  onDestructiveApproval?: (request: { type: 'delete' | 'rename'; filePath: string; newPath?: string }) => Promise<boolean>;
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
  pendingEdits?: { filePath: string; content: string; existed: boolean; originalContent: string; rejected?: boolean }[];
  /**
   * Per-file review gate (shared with the main process). Values:
   * - 'pending'  — proposed, awaiting user review
   * - 'rejected' — user rejected the change; apply_pending_edits must skip it
   * - 'applied'  — already written to disk
   * `apply_pending_edits` only honors 'rejected'; everything else is applied.
   */
  editGate?: Map<string, 'pending' | 'rejected' | 'applied'>;
  /** Currently activated skill (injected into the system prompt when set). */
  activeSkillId?: string;
}
