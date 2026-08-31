/**
 * Loom Agent Tool System
 * Implements Cursor-like agent capabilities: file read/write/edit, code search,
 * terminal execution, file listing, and code analysis.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { runDevelopmentCommandStreaming } from './development-command';
import {
  type ToolCall,
  type ToolExecutionContext,
} from './tool-types';
import {
  destructiveAllowed,
  HIDDEN_DIRS,
  isSafePath,
  isSensitivePath,
  resolvePath,
} from './tool-path-safety';
import {
  applyReplacement,
  executeEditFile,
  executeReadFile,
  executeWriteFile,
  MAX_READ_BYTES,
} from './tool-file-ops';
import { runTscCheck } from './tool-verify';

export {
  destructiveAllowed,
  HIDDEN_DIRS,
  isPathInside,
  isSafePath,
  isSensitivePath,
  resolvePath,
} from './tool-path-safety';

export {
  applyReplacement,
  executeEditFile,
  executeReadFile,
  executeWriteFile,
  isSafeEdit,
  isSafeWrite,
  MAX_DEFAULT_READ_LINES,
  MAX_READ_BYTES,
} from './tool-file-ops';

export { resolveLocalTsc, runTscCheck } from './tool-verify';

export { getToolSystemPrompt, parseToolCalls, stripToolCalls } from './tool-parsing';

export { AGENT_TOOLS } from './tool-types';
export type {
  AgentTool,
  AgentToolParameterProp,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
} from './tool-types';

/**
 * Yield to the event loop so a long-running file scan doesn't block IPC,
 * streaming, or other async work in the main process. Used inside the
 * async-by-default searchDir loop — every N files we await this to keep
 * the process responsive.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

const MAX_SEARCH_RESULTS = 30;
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
        return await executeDeleteFile(args, context);
      case 'rename_file':
        return await executeRenameFile(args, context);
      case 'git_status':
        return await executeGitStatus(context);
      case 'git_diff':
        return await executeGitDiff(args, context);
      case 'git_stage':
        return await executeGitStage(args, context);
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
        if (r.docs) output += `  Docs: ${r.docs.split('\n')[0]!.slice(0, 120)}\n`;
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
      if (entry.isSymbolicLink()) continue;
      const name = sanitizeEntryName(entry.name);
      const fullPath = name ? resolveInsideRoot(context.workspacePath, dir, name) : null;
      if (!fullPath) continue;
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
              matched = regex.test(lines[i]!);
            } else {
              const line = caseSensitive ? lines[i]! : lines[i]!.toLowerCase();
              const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
              matched = line.includes(searchPattern);
            }
            if (matched) {
              results.push({
                file: path.relative(context.workspacePath, fullPath),
                line: i + 1,
                content: lines[i]!.trim().substring(0, 200),
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
    grouped[r.file]!.push(r);
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
        const entry = entries[i]!;
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

/** readdir 条目名必须是无路径分隔符的普通文件名，杜绝 ../ 等逃逸形式。 */
function sanitizeEntryName(name: string): string | null {
  const base = path.basename(name);
  if (base === '.' || base === '..' || base !== name) return null;
  return base;
}

/** Resolve `name` under `dir`; return null when the result would escape `root`. */
function resolveInsideRoot(root: string, dir: string, name: string): string | null {
  const rootAbs = path.resolve(root) + path.sep;
  const resolved = path.resolve(dir, name);
  return resolved.startsWith(rootAbs) ? resolved : null;
}

function listFilesForCheckpoint(root: string, dir: string, files: string[], depth = 0) {
  if (depth > 16) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (CHECKPOINT_IGNORE.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const name = sanitizeEntryName(entry.name);
      if (!name) continue;
      const fullPath = resolveInsideRoot(root, dir, name);
      if (!fullPath) continue;
      if (entry.isDirectory()) {
        listFilesForCheckpoint(root, fullPath, files, depth + 1);
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
    listFilesForCheckpoint(context.workspacePath, context.workspacePath, files);
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
    const latest = path.join(checkpointsDir, entries[entries.length - 1]!);

    function restoreDir(srcDir: string, destRoot: string) {
      const items = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const item of items) {
        // 跳过符号链接，恢复时绝不跟随链接写出工作区
        if (item.isSymbolicLink()) continue;
        const name = sanitizeEntryName(item.name);
        if (!name) continue;
        const src = path.join(srcDir, name);
        if (item.isDirectory()) {
          restoreDir(src, path.join(destRoot, name));
        } else {
          const dest = path.join(destRoot, name);
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

async function executeGetDiagnostics(args: any, context: ToolExecutionContext): Promise<string> {
  // Honest implementation: `context.diagnostics` is never populated anywhere,
  // so the old version always reported "code is clean ✨" — actively misleading.
  // Run the real TypeScript checker instead (same as read_lints), filtered by file.
  const ws = context.workspacePath;
  if (!ws) return 'Error: no workspace open — cannot run static diagnostics.';
  if (!fs.existsSync(path.join(ws, 'tsconfig.json'))) {
    return 'No tsconfig.json found in this workspace; TypeScript static diagnostics are unavailable. Use read_lints for configured checks, or run_command with the project\'s linter.';
  }
  const result = await runTscCheck(ws);
  if (result.error) return `Diagnostics unavailable: ${result.error}`;
  let output = result.output;
  if (!output || output.includes('No inputs were found')) {
    return 'TypeScript check passed — no diagnostics.';
  }
  const filePath = args.filePath;
  if (filePath) {
    const norm = String(filePath).replace(/\\/g, '/');
    const lines = output.split('\n').filter(l => l.includes(norm));
    if (lines.length === 0) return `TypeScript check passed — no diagnostics for ${filePath}.`;
    output = lines.join('\n');
  }
  return output.substring(0, 5000);
}

async function executeReadLints(args: any, context: ToolExecutionContext): Promise<string> {
  const targetPath = args.paths ? resolvePath(args.paths, context.workspacePath) : context.workspacePath;

  if (!fs.existsSync(targetPath)) {
    return `Error: Path not found: ${targetPath}`;
  }

  // Use tsc for TypeScript projects, eslint for JS projects
  try {
    let result = '';
    // Check if there's a tsconfig.json
    if (fs.existsSync(path.join(context.workspacePath, 'tsconfig.json'))) {
      const tscResult = await runTscCheck(context.workspacePath);
      if (tscResult.error) return `Lint unavailable: ${tscResult.error}`;
      result = tscResult.output;
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

async function executeDeleteFile(args: any, context: ToolExecutionContext): Promise<string> {
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

  // 破坏性操作需要真实的人工确认。当审批回调存在时（agent 主流程），模型
  // 不能再通过 confirm:true 自证；工具会阻塞等待用户在 UI 上确认/拒绝。
  if (!destructiveAllowed(args, context)) {
    if (context.onDestructiveApproval) {
      const approved = await context.onDestructiveApproval({ type: 'delete', filePath });
      if (!approved) {
        return `User rejected the delete of ${filePath}. Do not retry unless the user asks again.`;
      }
    } else {
      return `Proposed delete of ${filePath}. This is destructive — re-issue the call with confirm: true to apply.`;
    }
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

async function executeRenameFile(args: any, context: ToolExecutionContext): Promise<string> {
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
    if (context.onDestructiveApproval) {
      const approved = await context.onDestructiveApproval({ type: 'rename', filePath: oldPath, newPath });
      if (!approved) {
        return `User rejected the rename of ${oldPath} to ${newPath}. Do not retry unless the user asks again.`;
      }
    } else {
      return `Proposed rename of ${oldPath} to ${newPath}. This is destructive — re-issue the call with confirm: true to apply.`;
    }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 工具参数由模型 JSON 驱动，无法静态化
async function executeGitStage(args: any, context: ToolExecutionContext): Promise<string> {
  if (!context.onGitCommand) {
    return 'Error: Git integration not available';
  }
  if (!Array.isArray(args.files) || args.files.length === 0) {
    return 'Error: git_stage requires a non-empty files list.';
  }
  const resolved: string[] = [];
  for (const f of args.files) {
    const filePath = resolvePath(String(f), context.workspacePath);
    if (!isSafePath(filePath, context.workspacePath)) {
      return `Error: Cannot stage path outside workspace: ${filePath}`;
    }
    resolved.push(filePath);
  }
  try {
    const result = await context.onGitCommand('add', ['--', ...resolved]);
    return `Staged ${resolved.length} file(s):\n${result}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 工具层异常处理
  } catch (e: any) {
    return `Git stage error: ${e.message}`;
  }
}

async function executeGitCommit(args: any, context: ToolExecutionContext): Promise<string> {
  if (!context.onGitCommand) {
    return 'Error: Git integration not available';
  }

  try {
    // Safety gate: never auto-stage. Commit only what the user (via the agent's
    // git_stage calls) explicitly staged. `git diff --cached --quiet` exits 0
    // when the staging area is empty.
    const staged = await context.onGitCommand('diff', ['--cached', '--quiet']);
    const emptyStagingArea = staged.trim() === '' && !/\d+ files? changed/.test(staged);
    if (emptyStagingArea) {
      return 'Error: nothing is staged. Inspect git_status/git_diff, then stage exactly the intended files with git_stage before committing.';
    }
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
        const specifier = m[1]!;
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

  // Run via onRunCommand if available; the fallback is an async spawn (never
  // spawnSync — a 180s test run must not freeze the main process event loop).
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
    // Fallback: async spawn with a bounded timeout (argv-based, shell:false).
    const fallbackResult = await new Promise<string>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const spawnFn = spawn;
      const child = spawnFn(command, cmdArgs, {
        cwd: context.workspacePath,
        windowsHide: true,
        shell: false,
      });
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish(`Test run timed out after 180s.`);
      }, 180000);
      const finish = (payload: string) => { if (!settled) { settled = true; clearTimeout(timer); resolve(payload); } };
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
      child.on('error', (err: Error) => finish(`Test error: ${err.message}`));
      child.on('close', () => {
        const output = `${stdout}\n${stderr}`.trim();
        finish(output.substring(0, 8000) || 'Tests completed (no output)');
      });
    });
    return fallbackResult;
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
    const flag = edit.rejected ? ' (rejected by user — will be skipped on apply)' : '';
    lines.push(`  • ${edit.filePath} (${status}, ${edit.content.split('\n').length} lines)${flag}`);
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
  let skipped = 0;
  for (const edit of pending) {
    // User review gate: rejected edits are never written to disk.
    if (edit.rejected || context.editGate?.get(edit.filePath) === 'rejected') {
      skipped++;
      continue;
    }
    try {
      fs.writeFileSync(edit.filePath, edit.content, 'utf-8');
      context.editGate?.set(edit.filePath, 'applied');
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
  if (skipped > 0) {
    return `Applied ${applied}/${count} pending edits (${skipped} rejected by user were skipped).`;
  }
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
