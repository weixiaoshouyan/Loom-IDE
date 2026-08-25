/**
 * Configurable command allow-block policy.
 *
 * Previously the allowed/blocked command sets were hard-coded in
 * `development-command.ts` and `agent-tools.ts`. This module owns a single,
 * configurable source of truth stored under `agent.commandPolicy` in the
 * main-process config (editable via `settings:set('agent.allowedCommands', [...])`).
 *
 * Two layers:
 *   - **Blocked** (deny-list): overrides everything — a blocked command is never
 *     allowed even if it appears on the allow-list. Ships with a sensible
 *     default but the user can extend or clear it.
 *   - **Allowed** (allow-list): the clean-list of permitted executables. Any
 *     command not in this set is rejected.
 *
 * On Windows, `.exe` / `.cmd` / `.bat` suffixes are stripped before matching so
 * users can write `git` and it matches `git.exe`.
 */
import { loadConfig } from './config';

// ---- Defaults (mirrors the original hard-coded sets) ------------------------

export const DEFAULT_ALLOWED_COMMANDS = new Set([
  'npm', 'pnpm', 'yarn',
  'node', 'npx', 'tsx', 'ts-node', 'deno', 'bun',
  'tsc',
  'git',
  'python', 'python3', 'pip', 'pip3',
  'vitest', 'jest', 'mocha', 'cypress', 'playwright',
  'eslint', 'prettier',
  'cargo', 'rustc', 'go', 'dotnet',
  'javac', 'java', 'gradle', 'mvn',
  'gcc', 'g++', 'clang', 'clang++', 'make', 'cmake',
  'powershell', 'pwsh',
]);

export const DEFAULT_BLOCKED_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'format', 'fdisk', 'mkfs', 'dd',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'chmod', 'chown', 'chgrp',
  'sudo', 'su', 'runas',
  'reg', 'regedit',
  'net', 'netsh',
  'taskkill', 'tskill',
  'curl', 'wget',
  'pkill', 'kill', 'killall',
  'systemctl', 'service',
  'iptables', 'ufw',
  'mount', 'umount',
  'parted', 'lvm', 'vgcreate', 'lvcreate',
  'cmd', 'sh', 'bash', 'zsh', 'fish',
  // PowerShell aliases for the destructive verbs above — `ri` == Remove-Item
  // == `del`, `iwr` == Invoke-WebRequest == `curl`, etc. Without these, the
  // blocked list is trivially bypassed with an alias.
  'ri', 'rd', 'erase', 'ren',
  'mi', 'mv', 'cp', 'ci', 'copy', 'ni',
  'sc', 'ac', 'of', 'out-file',
  'iex', 'iwr', 'irm', 'saps', 'start',
  'remove-item', 'rename-item', 'move-item', 'copy-item', 'new-item',
  'set-content', 'add-content', 'clear-content', 'remove-file',
  'invoke-expression', 'invoke-webrequest', 'invoke-restmethod',
  'start-process', 'stop-process', 'debug-process', 'wait-process',
]);

// ---- Runtime cache ----------------------------------------------------------

let _allowed: Set<string> | null = null;
let _blocked: Set<string> | null = null;
let _allowInlineInterpreterCode = false;
let _loaded = false;

// ---- Interpreter inline-code escape hatch -----------------------------------
//
// Interpreters like `node`/`python`/`powershell` are on the allow-list because
// they drive the toolchain, but flags such as `node -e "..."`, `python -c
// "..."` or `powershell -Command "..."` execute ARBITRARY code, which makes the
// blocked-list moot. By default we reject those inline-code flags; the user can
// opt back in via `agent.commandPolicy.allowInlineInterpreterCode`.

/** Exact inline-code flags per interpreter (matched case-insensitively). */
const INTERPRETER_INLINE_FLAGS: Record<string, RegExp> = {
  node: /^--?(e|eval|p|print)$/i,
  bun: /^--?(e|eval|p|print)$/i,
  deno: /^eval$/i,
  tsx: /^--?(e|eval)$/i,
  'ts-node': /^--?(e|eval|p|print)$/i,
  python: /^-c$/i,
  python3: /^-c$/i,
};

const POWERSHELL_INTERPRETERS = new Set(['powershell', 'pwsh']);

/**
 * PowerShell accepts prefix-abbreviated switches (e.g. `-c`, `-com`, `-Command`,
 * `-e`, `-enc`, `-EncodedCommand`). Treat any arg that abbreviates `-Command`
 * or `-EncodedCommand` as inline code. `-File` (running a script) is allowed.
 */
function isPowerShellInlineFlag(arg: string): boolean {
  const m = /^-{1,2}([a-z]+)$/i.exec(arg.trim());
  if (!m) return false;
  const name = m[1]!.toLowerCase();
  return 'command'.startsWith(name) || 'encodedcommand'.startsWith(name);
}

/**
 * Returns an error string if the command+args would execute inline code and the
 * escape hatch is disabled; otherwise `undefined`. Exported so both
 * `development-command.ts` and the MCP layer can share one source of truth.
 */
export function validateInterpreterArgs(command: string, args: string[]): string | undefined {
  ensureLoaded();
  if (_allowInlineInterpreterCode) return undefined;
  const base = normalizeCommandName(command);
  const isPwsh = POWERSHELL_INTERPRETERS.has(base);
  const exactMatcher = INTERPRETER_INLINE_FLAGS[base];
  if (!isPwsh && !exactMatcher) return undefined;
  for (const raw of args) {
    const arg = String(raw);
    const hit = isPwsh ? isPowerShellInlineFlag(arg) : exactMatcher!.test(arg);
    if (hit) {
      return `Inline code execution via "${base} ${arg}" is blocked by policy. `
        + `Run a script file instead, or enable agent.commandPolicy.allowInlineInterpreterCode to permit it.`;
    }
  }
  return undefined;
}

/** For diagnostics/tests: whether the inline-code escape hatch is currently on. */
export function isInlineInterpreterCodeAllowed(): boolean {
  ensureLoaded();
  return _allowInlineInterpreterCode;
}

/** Strip Windows executable suffixes and lowercase for matching. */
export function normalizeCommandName(command: string): string {
  return command.trim().toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
}

/** Reload policy from config. Called at startup and after settings change.
 *  Safe to call before Electron `app` is ready — falls back to defaults. */
export function reloadCommandPolicy(): void {
  let cfg: any = {};
  try {
    cfg = loadConfig();
  } catch {
    // app not ready (e.g. unit tests) — use defaults only.
  }
  const policy = cfg?.agent?.commandPolicy || {};
  _allowed = new Set(
    Array.isArray(policy.allowedCommands) && policy.allowedCommands.length > 0
      ? policy.allowedCommands.map((c: string) => normalizeCommandName(c))
      : DEFAULT_ALLOWED_COMMANDS,
  );
  _blocked = new Set([
    ...DEFAULT_BLOCKED_COMMANDS,
    ...(Array.isArray(policy.extraBlockedCommands)
      ? policy.extraBlockedCommands.map((c: string) => normalizeCommandName(c))
      : []),
  ]);
  // Default: reject interpreter inline-code flags (opt-in escape hatch).
  _allowInlineInterpreterCode = policy.allowInlineInterpreterCode === true;
  _loaded = true;
}

/** Ensure the cached sets are populated. */
function ensureLoaded(): void {
  if (!_loaded) reloadCommandPolicy();
}

/** The current allowed-set (lowercased, suffix-stripped). Note: this returns
 *  a copy so callers can't mutate the live policy. */
export function getAllowedCommands(): Set<string> {
  ensureLoaded();
  return new Set(_allowed!);
}

/** The current blocked-set (always includes DEFAULT_BLOCKED_COMMANDS plus any
 *  user-added extraBlockedCommands). */
export function getBlockedCommands(): Set<string> {
  ensureLoaded();
  return new Set(_blocked!);
}

/**
 * Core authorization check used by both `development-command.ts` and the
 * agent-tools `ALLOWED_COMMANDS` lookup. Order:
 *   1. If the command is blocked → reject (deny takes precedence).
 *   2. If the command is allowed → accept.
 *   3. Otherwise → reject.
 */
export function isCommandAllowed(command: string): boolean {
  ensureLoaded();
  const base = normalizeCommandName(command);
  if (!base) return false;
  if (_blocked!.has(base)) return false;
  return _allowed!.has(base);
}
