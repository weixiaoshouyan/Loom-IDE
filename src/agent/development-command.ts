import path from 'path';
import { spawn, spawnSync } from 'child_process';

export interface ParsedDevelopmentCommand {
  command?: string;
  args?: string[];
  error?: string;
}

export interface DevelopmentCommandRequest {
  taskId?: string;
  command: string;
  args: string[];
  cwd: string;
  workspacePath?: string;
  timeoutMs?: number;
  retryCount?: number;
  abortSignal?: AbortSignal;
}

export interface DevelopmentCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  taskId?: string;
  history?: DevelopmentCommandEvent[];
  attempts?: number;
}

export interface DevelopmentCommandEvent {
  taskId: string;
  type: 'queued' | 'started' | 'stdout' | 'stderr' | 'exit' | 'error' | 'retry' | 'cancelled';
  command: string;
  args: string[];
  cwd: string;
  attempt: number;
  timestamp: string;
  data?: string;
  exitCode?: number | null;
  error?: string;
}

// The static defaults live in main/command-policy.ts (which also handles the
// user-configurable overlay). We keep a local reference here only as a last
// resort if the policy module hasn't been loaded yet (e.g. unit tests that
// import this file directly without booting Electron).
import { isCommandAllowed, reloadCommandPolicy, validateInterpreterArgs } from '../main/command-policy';
// Trigger a reload on import so the cached overlay is warm.
reloadCommandPolicy();

const SHELL_SYNTAX = /[;&|<>`]/;
const MAX_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const POWERSHELL_BLOCKED_PATTERNS = [
  /\bremove-item\b/i,
  /\bdel\b/i,
  /\brm\b/i,
  /\brmdir\b/i,
  /\bformat-volume\b/i,
  /\bclear-disk\b/i,
  /\bremove-partition\b/i,
  /\bstop-computer\b/i,
  /\brestart-computer\b/i,
  /\binvoke-expression\b/i,
  /\biex\b/i,
  /\bstart-process\b/i,
  /\bset-executionpolicy\b/i,
];

export function isAllowedDevelopmentCommand(command: string): boolean {
  return isCommandAllowed(command);
}

// ---------------------------------------------------------------------------
// Argument-level policy (the command allow-list only checks the executable).
// ---------------------------------------------------------------------------

/** git subcommands that can destroy work or rewrite history, with the flag
 *  pattern that makes them dangerous. The model may still need benign git
 *  (status/diff/add/commit/push/checkout <branch>), so only the destructive
 *  flag combinations are blocked. */
const GIT_DANGEROUS_PATTERNS: Array<{ sub: string; test: (flags: string[]) => boolean; reason: string }> = [
  { sub: 'clean', test: f => f.some(a => /^-/.test(a) && /[fFdDxX]/.test(a)), reason: 'clean -f/-d/-x discards untracked files irreversibly' },
  { sub: 'reset', test: f => f.some(a => a === '--hard'), reason: 'reset --hard discards working-tree changes irreversibly' },
  { sub: 'checkout', test: f => f.some(a => a === '--' || a === '.'), reason: 'checkout -- <path> discards working-tree changes' },
  { sub: 'push', test: f => f.some(a => a === '--force' || a === '-f'), reason: 'push --force rewrites remote history' },
  { sub: 'branch', test: f => f.some(a => a === '-D'), reason: 'branch -D deletes branches without confirmation' },
  { sub: 'tag', test: f => f.some(a => a === '-d' || a === '--delete'), reason: 'tag -d deletes tags' },
  { sub: 'rm', test: f => f.some(a => a === '-r' || a === '-rf' || a === '-fr'), reason: 'rm -r deletes files from disk and the index' },
];

/** Returns an error string if the git invocation is destructive; otherwise undefined. */
export function validateGitArgs(command: string, args: string[]): string | undefined {
  if (getCommandBaseName(command) !== 'git') return undefined;
  const sub = (args[0] || '').toLowerCase();
  for (const rule of GIT_DANGEROUS_PATTERNS) {
    if (rule.sub === sub && rule.test(args.slice(1))) {
      return `Git "${rule.sub}" with ${rule.reason}. This is blocked by policy — ask the user to run it manually.`;
    }
  }
  return undefined;
}

/** Force npx to resolve packages from the local workspace only — never
 *  silently download-and-execute from the npm registry. */
export function normalizeCommandArgs(command: string, args: string[]): string[] {
  if (getCommandBaseName(command) === 'npx' && !args.includes('--no-install')) {
    return ['--no-install', ...args];
  }
  return args;
}

function getCommandBaseName(command: string): string {
  return path.basename(command.trim()).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
}

function validatePowerShellArgs(command: string, args: string[]): string | undefined {
  const baseName = getCommandBaseName(command);
  if (baseName !== 'powershell' && baseName !== 'pwsh') return undefined;

  const joined = args.join(' ');
  for (const pattern of POWERSHELL_BLOCKED_PATTERNS) {
    if (pattern.test(joined)) {
      return 'PowerShell command blocked by the PowerShell safety policy.';
    }
  }

  return undefined;
}

export function parseDevelopmentCommand(commandLine: string): ParsedDevelopmentCommand {
  const trimmed = commandLine.trim();
  if (!trimmed) return { error: 'Command is required.' };
  if (SHELL_SYNTAX.test(trimmed)) return { error: 'Command contains unsupported shell syntax.' };

  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (quote) return { error: 'Command contains an unterminated quote.' };
  if (current) parts.push(current);
  if (parts.length === 0) return { error: 'Command is required.' };

  const [command, ...args] = parts;
  if (!isAllowedDevelopmentCommand(command)) {
    return { error: `Command "${command}" is not in the allowed development command list.` };
  }
  return { command, args };
}

export function isWorkspacePath(candidate: string, workspacePath?: string): boolean {
  if (!workspacePath) return true;
  const workspace = path.resolve(workspacePath);
  const resolved = path.resolve(candidate);
  return resolved === workspace || resolved.startsWith(workspace + path.sep);
}

export function runDevelopmentCommand(request: DevelopmentCommandRequest): DevelopmentCommandResult {
  // Normalize once at the top so validation and spawn both see the same args
  // (npx → force local resolution, never registry install).
  request = { ...request, args: normalizeCommandArgs(request.command, request.args.map(String)) };

  if (!isAllowedDevelopmentCommand(request.command)) {
    return {
      exitCode: null,
      stdout: '',
      stderr: `Command "${request.command}" is not in the allowed development command list.`,
    };
  }

  const gitError = validateGitArgs(request.command, request.args.map(String));
  if (gitError) {
    return { exitCode: null, stdout: '', stderr: gitError };
  }

  const powerShellError = validatePowerShellArgs(request.command, request.args.map(String));
  if (powerShellError) {
    return {
      exitCode: null,
      stdout: '',
      stderr: powerShellError,
    };
  }

  const inlineCodeError = validateInterpreterArgs(request.command, request.args.map(String));
  if (inlineCodeError) {
    return {
      exitCode: null,
      stdout: '',
      stderr: inlineCodeError,
    };
  }

  const cwd = path.resolve(request.cwd);
  if (!isWorkspacePath(cwd, request.workspacePath)) {
    return {
      exitCode: null,
      stdout: '',
      stderr: `Working directory is outside workspace: ${cwd}`,
    };
  }

  const result = spawnSync(request.command, request.args.map(String), {
    cwd,
    encoding: 'utf-8',
    timeout: Math.min(Math.max(request.timeoutMs ?? 120000, 1000), MAX_COMMAND_TIMEOUT_MS),
    maxBuffer: 1024 * 1024 * 2,
    windowsHide: true,
    shell: false,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  return {
    exitCode: result.status,
    stdout,
    stderr,
    error: result.error?.message,
  };
}

function createTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEvent(
  taskId: string,
  type: DevelopmentCommandEvent['type'],
  request: DevelopmentCommandRequest,
  attempt: number,
  patch: Partial<DevelopmentCommandEvent> = {},
): DevelopmentCommandEvent {
  return {
    taskId,
    type,
    command: request.command,
    args: request.args.map(String),
    cwd: path.resolve(request.cwd),
    attempt,
    timestamp: new Date().toISOString(),
    ...patch,
  };
}

function validateDevelopmentCommandRequest(request: DevelopmentCommandRequest): string | undefined {
  if (!isAllowedDevelopmentCommand(request.command)) {
    return `Command "${request.command}" is not in the allowed development command list.`;
  }
  const cwd = path.resolve(request.cwd);
  if (!isWorkspacePath(cwd, request.workspacePath)) {
    return `Working directory is outside workspace: ${cwd}`;
  }
  const gitError = validateGitArgs(request.command, request.args.map(String));
  if (gitError) return gitError;
  const powerShellError = validatePowerShellArgs(request.command, request.args.map(String));
  if (powerShellError) return powerShellError;
  return validateInterpreterArgs(request.command, request.args.map(String));
}

export async function runDevelopmentCommandStreaming(
  request: DevelopmentCommandRequest,
  onEvent?: (event: DevelopmentCommandEvent) => void,
): Promise<DevelopmentCommandResult & { history: DevelopmentCommandEvent[] }> {
  // Same arg normalization as the sync path (npx → --no-install).
  request = { ...request, args: normalizeCommandArgs(request.command, request.args.map(String)) };
  const taskId = request.taskId || createTaskId();
  const history: DevelopmentCommandEvent[] = [];
  const emit = (event: DevelopmentCommandEvent) => {
    history.push(event);
    onEvent?.(event);
  };

  const validationError = validateDevelopmentCommandRequest(request);
  if (validationError) {
    const event = createEvent(taskId, 'error', request, 1, { error: validationError });
    emit(event);
    return { taskId, exitCode: null, stdout: '', stderr: validationError, error: validationError, history, attempts: 0 };
  }

  const maxAttempts = Math.max(1, Math.min((request.retryCount ?? 0) + 1, 4));
  let finalStdout = '';
  let finalStderr = '';
  let finalExitCode: number | null = null;
  let finalError: string | undefined;

  emit(createEvent(taskId, 'queued', request, 1));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await new Promise<DevelopmentCommandResult>((resolve) => {
      const cwd = path.resolve(request.cwd);
      const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 120000, 1000), MAX_COMMAND_TIMEOUT_MS);
      let stdout = '';
      let stderr = '';
      let settled = false;

      emit(createEvent(taskId, 'started', request, attempt));
      const child = spawn(request.command, request.args.map(String), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });

      const finish = (payload: DevelopmentCommandResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        request.abortSignal?.removeEventListener('abort', abortHandler);
        resolve(payload);
      };

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        const error = `Command timed out after ${timeoutMs}ms.`;
        emit(createEvent(taskId, 'error', request, attempt, { error }));
        finish({ taskId, exitCode: null, stdout, stderr, error });
      }, timeoutMs);

      const abortHandler = () => {
        try { child.kill(); } catch {}
        const error = 'Command cancelled by user.';
        emit(createEvent(taskId, 'cancelled', request, attempt, { error }));
        finish({ taskId, exitCode: null, stdout, stderr, error });
      };
      if (request.abortSignal?.aborted) {
        abortHandler();
        return;
      }
      request.abortSignal?.addEventListener('abort', abortHandler, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        const data = chunk.toString('utf-8');
        stdout += data;
        emit(createEvent(taskId, 'stdout', request, attempt, { data }));
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const data = chunk.toString('utf-8');
        stderr += data;
        emit(createEvent(taskId, 'stderr', request, attempt, { data }));
      });
      child.on('error', (err) => {
        emit(createEvent(taskId, 'error', request, attempt, { error: err.message }));
        finish({ taskId, exitCode: null, stdout, stderr, error: err.message });
      });
      child.on('close', (code) => {
        emit(createEvent(taskId, 'exit', request, attempt, { exitCode: code }));
        finish({ taskId, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });

    finalStdout = result.stdout;
    finalStderr = result.stderr;
    finalExitCode = result.exitCode;
    finalError = result.error;

    // Never retry a TIMEOUT: a hung command would otherwise replay up to
    // retryCount+1 × timeoutMs (e.g. 3 × 10 min = 30 min of stuck agent turns).
    // Timeouts return exitCode null with an error message — treat them as
    // terminal, not as a retryable failure.
    const timedOut = !!finalError && /timed out/i.test(finalError);
    const shouldRetry = attempt < maxAttempts && !request.abortSignal?.aborted && !timedOut && finalExitCode !== 0;
    if (!shouldRetry) {
      return {
        taskId,
        exitCode: finalExitCode,
        stdout: finalStdout,
        stderr: finalStderr,
        error: finalError,
        history,
        attempts: attempt,
      };
    }

    emit(createEvent(taskId, 'retry', request, attempt + 1, {
      data: `Retrying after exit code ${finalExitCode ?? 'unknown'}`,
      exitCode: finalExitCode,
    }));
  }

  return {
    taskId,
    exitCode: finalExitCode,
    stdout: finalStdout,
    stderr: finalStderr,
    error: finalError,
    history,
    attempts: maxAttempts,
  };
}

export interface QueuedDevelopmentCommand {
  id: string;
  request: DevelopmentCommandRequest;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  history: DevelopmentCommandEvent[];
  result?: DevelopmentCommandResult;
  controller: AbortController;
}

export class DevelopmentCommandQueue {
  private tasks: QueuedDevelopmentCommand[] = [];
  private tail: Promise<void> = Promise.resolve();
  private maxHistory = 100;

  enqueue(
    request: DevelopmentCommandRequest,
    onEvent?: (event: DevelopmentCommandEvent) => void,
  ): Promise<DevelopmentCommandResult & { history: DevelopmentCommandEvent[] }> {
    const id = request.taskId || createTaskId();
    const controller = new AbortController();
    const task: QueuedDevelopmentCommand = {
      id,
      request: { ...request, taskId: id, abortSignal: controller.signal },
      status: 'queued',
      createdAt: new Date().toISOString(),
      history: [],
      controller,
    };
    this.tasks.unshift(task);
    this.tasks = this.tasks.slice(0, this.maxHistory);

    const run = async () => {
      if (task.status === 'cancelled') {
        return {
          taskId: id,
          exitCode: null,
          stdout: '',
          stderr: 'Command cancelled before start.',
          error: 'Command cancelled before start.',
          history: task.history,
          attempts: 0,
        };
      }
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      const result = await runDevelopmentCommandStreaming(task.request, event => {
        task.history.push(event);
        onEvent?.(event);
      });
      task.result = result;
      task.finishedAt = new Date().toISOString();
      if (result.error === 'Command cancelled by user.') task.status = 'cancelled';
      else task.status = result.exitCode === 0 ? 'succeeded' : 'failed';
      return result;
    };

    const promise = this.tail.then(run, run);
    this.tail = promise.then(() => undefined, () => undefined);
    return promise;
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.find(item => item.id === taskId);
    if (!task) return false;
    if (task.status === 'queued') {
      task.status = 'cancelled';
      task.finishedAt = new Date().toISOString();
      return true;
    }
    if (task.status === 'running') {
      task.controller.abort();
      return true;
    }
    return false;
  }

  retry(
    taskId: string,
    onEvent?: (event: DevelopmentCommandEvent) => void,
  ): Promise<DevelopmentCommandResult & { history: DevelopmentCommandEvent[] }> | null {
    const task = this.tasks.find(item => item.id === taskId);
    if (!task || task.status === 'queued' || task.status === 'running') return null;
    const { abortSignal: _abortSignal, taskId: _taskId, ...request } = task.request;
    return this.enqueue({
      ...request,
      retryCount: task.request.retryCount,
    }, onEvent);
  }

  list() {
    return this.tasks.map(({ controller: _controller, ...task }) => task);
  }

  get(taskId: string) {
    const task = this.tasks.find(item => item.id === taskId);
    if (!task) return undefined;
    const { controller: _controller, ...snapshot } = task;
    return snapshot;
  }
}
