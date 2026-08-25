import fs from 'fs';
import path from 'path';
import { isSafePath, isSensitivePath, resolvePath } from './tool-path-safety';
import type { ToolExecutionContext } from './tool-types';

/** 硬上限：read_file 单次读取的文件字节数，避免把超大文件整体载入内存 */
export const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB
/** 未指定 endLine 时默认返回的最大行数，避免把超大文件灌满 Agent 上下文 */
export const MAX_DEFAULT_READ_LINES = 2000;

export function executeReadFile(args: any, context: ToolExecutionContext): string {
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

export function isSafeWrite(args: any, existed: boolean): boolean {
  // New files are considered safe to create automatically.
  if (!existed) return true;
  return false;
}

export function isSafeEdit(args: any): boolean {
  // Simple single-line edits with small strings are considered safe.
  const oldString = String(args.oldString || '');
  const newString = String(args.newString || '');
  if (args.replaceAll === true) return false;
  if (oldString.split('\n').length > 1 || newString.split('\n').length > 1) return false;
  if (oldString.length > 200 || newString.length > 200) return false;
  return true;
}

export function executeWriteFile(args: any, context: ToolExecutionContext): string {
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
    context.editGate?.set(filePath, 'pending');
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

export function executeEditFile(args: any, context: ToolExecutionContext): string {
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
    context.editGate?.set(filePath, 'pending');
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
export function applyReplacement(
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
