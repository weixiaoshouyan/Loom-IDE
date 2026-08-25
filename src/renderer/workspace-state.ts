import type { OpenFile } from './App';

export interface WorkspaceState {
  openFiles: OpenFile[];
  activeIdx: number;
  selectedFile: string;
  workspace: string;
}

export function isFsReadError(content: string): boolean {
  return typeof content === 'string' && content.startsWith('__ERR__:');
}

export function fsReadErrorMessage(content: string): string {
  return isFsReadError(content) ? content.slice('__ERR__:'.length) : content;
}

/** 归一化行尾为 LF，用于稳定地比较内容（Windows CRLF 与 LF 差异不应算作"已修改"）。 */
export function normalizeEOL(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 脏判定：content 与 originalContent 不同（忽略纯行尾差异）。 */
export function isFileDirty(content: string, originalContent: string): boolean {
  return normalizeEOL(content) !== normalizeEOL(originalContent);
}

export function upsertOpenFile(
  openFiles: OpenFile[],
  activeIdx: number,
  filePath: string,
  content: string,
  language: string,
): Pick<WorkspaceState, 'openFiles' | 'activeIdx' | 'selectedFile'> {
  const existing = openFiles.findIndex(f => f.path === filePath);
  if (existing >= 0) {
    const next = [...openFiles];
    const current = next[existing]!;
    const isDirty = isFileDirty(current.content, current.originalContent);
    if (!isDirty && !isFsReadError(content)) {
      next[existing] = {
        ...current,
        content,
        originalContent: content,
        language,
      };
    }
    return { openFiles: next, activeIdx: existing, selectedFile: filePath };
  }

  // 预览标签（VS Code 语义）：单击文件树/命令面板打开的文件默认是预览，
  // 若当前活动标签是未修改的预览标签，则替换它而不是无限堆积标签。
  // 双击钉住 / 编辑后自动转为正式标签（见 pinPreview 与 handleContentChange）。
  const active = openFiles[activeIdx];
  const canReplacePreview = !!active
    && active.isPreview === true
    && !isFileDirty(active.content, active.originalContent)
    && !active.path.startsWith('untitled-');

  const nf: OpenFile = {
    path: filePath,
    name: filePath.split(/[\\/]/).pop() || 'untitled',
    content,
    language,
    originalContent: content,
    isPreview: true,
  };

  if (canReplacePreview) {
    const next = [...openFiles];
    next[activeIdx] = nf;
    return { openFiles: next, activeIdx, selectedFile: filePath };
  }

  const next = [...openFiles, nf];
  return { openFiles: next, activeIdx: next.length - 1, selectedFile: filePath };
}

/** 将指定标签转为正式标签（双击钉住 / 点击标签 / 开始编辑时调用）。 */
export function pinOpenFile(openFiles: OpenFile[], filePath: string): OpenFile[] {
  return openFiles.map(f => (f.path === filePath && f.isPreview ? { ...f, isPreview: false } : f));
}

/** 打开文件时是否应作为预览标签（文件树单击路径）。 */
export function isPreviewFile(file: OpenFile): boolean {
  return file.isPreview === true;
}

export function closeWorkspaceState(_openFiles: OpenFile[]): WorkspaceState {
  return {
    openFiles: [],
    activeIdx: 0,
    selectedFile: '',
    workspace: '',
  };
}

export function inferWorkspaceFromOpenFiles(openFiles: OpenFile[]): string {
  const paths = openFiles
    .map(file => file.path)
    .filter(filePath => filePath && !filePath.startsWith('untitled-') && /[\\/]/.test(filePath))
    .map(filePath => filePath.replace(/\\/g, '/'));

  if (paths.length === 0) return '';

  const directories = paths.map(filePath => filePath.split('/').slice(0, -1));
  if (directories.length === 1) return directories[0]!.join('/');

  const first = directories[0]!;
  let end = first.length;
  for (const parts of directories.slice(1)) {
    end = Math.min(end, parts.length);
    for (let i = 0; i < end; i++) {
      if (first[i]!.toLowerCase() !== parts[i]!.toLowerCase()) {
        end = i;
        break;
      }
    }
  }
  return first.slice(0, end).join('/');
}
