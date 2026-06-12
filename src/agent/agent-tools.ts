/**
 * Loom Agent Tool System
 * Implements Cursor-like agent capabilities: file read/write/edit, code search,
 * terminal execution, file listing, and code analysis.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// === Tool Definitions ===

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
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
    description: 'Search for text or regex patterns across files in the project. Use this to find usages, definitions, or patterns in the codebase.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The text or regex pattern to search for' },
        fileTypes: { type: 'string', description: 'Optional: Comma-separated file extensions to filter (e.g., ".ts,.tsx,.js")' },
        maxResults: { type: 'number', description: 'Optional: Maximum number of results (default 20)' },
        caseSensitive: { type: 'boolean', description: 'Optional: Case-sensitive search (default false)' },
        useRegex: { type: 'boolean', description: 'Optional: Treat pattern as regex (default false)' },
      },
      required: ['pattern'],
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
    description: 'Execute a shell command and return the output. Use this for running tests, builds, linting, or any dev tool.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Optional: Working directory for the command' },
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
];

// === Tool Executor ===

export interface ToolExecutionContext {
  workspacePath: string;
  openFiles?: { path: string; content: string }[];
  diagnostics?: { severity: string; message: string; file?: string; line?: number }[];
  onFileCreated?: (filePath: string, content: string) => void;
  onFileChanged?: (filePath: string, content: string) => void;
}

const MAX_SEARCH_RESULTS = 30;
const HIDDEN_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '__pycache__', '.next', 'coverage', '.vscode', '.idea', 'build', 'target']);

function resolvePath(inputPath: string, workspacePath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(workspacePath, inputPath);
}

function isSafePath(filePath: string, workspacePath: string): boolean {
  const resolved = path.resolve(filePath);
  const normalizedWorkspace = path.resolve(workspacePath);
  return resolved.startsWith(normalizedWorkspace + path.sep) || resolved === normalizedWorkspace;
}

export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolExecutionContext
): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  let args: Record<string, any> = {};
  
  try {
    args = JSON.parse(argsStr);
  } catch {
    return `Error: Invalid JSON arguments: ${argsStr}`;
  }

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
        return executeRunCommand(args, context);
      case 'get_diagnostics':
        return executeGetDiagnostics(args, context);
      case 'read_lints':
        return executeReadLints(args, context);
      default:
        return `Error: Unknown tool "${name}"`;
    }
  } catch (e: any) {
    return `Error executing ${name}: ${e.message}`;
  }
}

function executeReadFile(args: any, context: ToolExecutionContext): string {
  const filePath = resolvePath(args.filePath, context.workspacePath);
  
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

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const start = (args.startLine || 1) - 1;
  const end = args.endLine ? args.endLine : lines.length;
  const selectedLines = lines.slice(start, end);
  
  return `File: ${filePath} (${lines.length} lines total)\nLines ${start + 1}-${Math.min(end, lines.length)}:\n\`\`\`\n${selectedLines.map((l, i) => `${start + i + 1}| ${l}`).join('\n')}\n\`\`\``;
}

function executeWriteFile(args: any, context: ToolExecutionContext): string {
  const filePath = resolvePath(args.filePath, context.workspacePath);
  
  if (!isSafePath(filePath, context.workspacePath)) {
    return `Error: Cannot write to path outside workspace: ${filePath}`;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, args.content, 'utf-8');
  
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

  if (!fs.existsSync(filePath)) {
    return `Error: File not found: ${filePath}`;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const replaceAll = args.replaceAll === true;
  
  if (!content.includes(args.oldString)) {
    const normalized = content.replace(/\r\n/g, '\n');
    const normalizedOld = args.oldString.replace(/\r\n/g, '\n');
    if (!normalized.includes(normalizedOld)) {
      return `Error: Could not find the exact text to replace in ${filePath}. The old_string must match exactly.`;
    }
    const newContent = replaceAll 
      ? normalized.split(normalizedOld).join(args.newString.replace(/\r\n/g, '\n'))
      : normalized.replace(normalizedOld, args.newString.replace(/\r\n/g, '\n'));
    fs.writeFileSync(filePath, newContent, 'utf-8');
  } else {
    const newContent = replaceAll 
      ? content.split(args.oldString).join(args.newString)
      : content.replace(args.oldString, args.newString);
    fs.writeFileSync(filePath, newContent, 'utf-8');
  }

  context.onFileChanged?.(filePath, fs.readFileSync(filePath, 'utf-8'));
  
  return `Successfully edited ${filePath}`;
}

function executeSearchCode(args: any, context: ToolExecutionContext): string {
  const pattern = args.pattern;
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

  function searchDir(dir: string, depth: number) {
    if (depth > 8 || results.length >= maxResults) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (HIDDEN_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (fileTypes && !fileTypes.some((ext: string) => entry.name.endsWith(ext))) continue;
          const ext = path.extname(entry.name).toLowerCase();
          const binaryExts = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.png', '.jpg', '.gif', '.ico', '.zip', '.tar', '.gz', '.pdf']);
          if (binaryExts.has(ext)) continue;
          
          try {
            searched++;
            const content = fs.readFileSync(fullPath, 'utf-8');
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
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  searchDir(context.workspacePath, 0);

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

const BLOCKED_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'format', 'fdisk', 'mkfs', 'dd',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'chmod', 'chown', 'chgrp',
  'sudo', 'su', 'runas',
  'reg', 'regedit',
  'net', 'netsh',
  'taskkill', 'tskill',
  'curl', 'wget',
]);

const DANGEROUS_PATTERNS = [
  />\s*\/dev\/sd/, /rm\s+-rf\s+[\/~]/, /format\s+[a-zA-Z]:/,
  /del\s+\/[sfq]/i, /\|\s*rm/, /;\s*rm/, /&&\s*rm/,
  /`rm|mkfs|dd\s+if=/, /\$\(.*rm/,
  /eval\s*\(/, /node\s+-e/, /python\s+-c/, /perl\s+-e/,
  /powershell\s+-[cC]/, /cmd\s+\/c\s+del/i,
];

function isDangerousCommand(command: string): boolean {
  const trimmed = command.trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
  const baseName = firstToken.split(/[\\/]/).pop() || firstToken;
  if (BLOCKED_COMMANDS.has(baseName)) return true;
  return false;
}

function executeRunCommand(args: any, context: ToolExecutionContext): string {
  const cwd = args.cwd ? resolvePath(args.cwd, context.workspacePath) : context.workspacePath;

  if (isDangerousCommand(args.command)) {
    return `Error: Command blocked for safety. The command "${args.command}" is not allowed. Use safer alternatives.`;
  }

  try {
    const result = execSync(args.command, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const output = result.trim();
    if (!output) return `Command executed successfully (no output)`;
    return output.substring(0, 5000);
  } catch (e: any) {
    const stdout = e.stdout?.trim();
    const stderr = e.stderr?.trim();
    let errorMsg = `Command failed with exit code ${e.status || 'unknown'}`;
    if (stderr) errorMsg += `\nStderr: ${stderr.substring(0, 1000)}`;
    if (stdout) errorMsg += `\nStdout: ${stdout.substring(0, 1000)}`;
    return errorMsg;
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
      try {
        result = execSync('npx tsc --noEmit --pretty', {
          cwd: context.workspacePath,
          encoding: 'utf-8',
          timeout: 60000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e: any) {
        // tsc --noEmit returns non-zero when there are errors, capture both stdout and stderr
        result = (e.stdout || '') + (e.stderr || '');
      }
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

  prompt += `\nTo use a tool, respond with a JSON tool call block like this:
\`\`\`tool_call
{"name": "read_file", "arguments": {"filePath": "src/index.ts"}}
\`\`\`

You can make multiple tool calls in sequence. After receiving tool results, continue responding to the user.
Always read files before editing them. Always search before making assumptions about the codebase.
When editing files, make sure the old_string matches exactly what's in the file.`;

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
