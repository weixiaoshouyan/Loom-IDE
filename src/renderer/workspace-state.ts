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
  _activeIdx: number,
  filePath: string,
  content: string,
  language: string,
): Pick<WorkspaceState, 'openFiles' | 'activeIdx' | 'selectedFile'> {
  const existing = openFiles.findIndex(f => f.path === filePath);
  if (existing >= 0) {
    const next = [...openFiles];
    const current = next[existing];
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

  const nf: OpenFile = {
    path: filePath,
    name: filePath.split(/[\\/]/).pop() || 'untitled',
    content,
    language,
    originalContent: content,
  };
  const next = [...openFiles, nf];
  return { openFiles: next, activeIdx: next.length - 1, selectedFile: filePath };
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
  if (directories.length === 1) return directories[0].join('/');

  const first = directories[0];
  let end = first.length;
  for (const parts of directories.slice(1)) {
    end = Math.min(end, parts.length);
    for (let i = 0; i < end; i++) {
      if (first[i].toLowerCase() !== parts[i].toLowerCase()) {
        end = i;
        break;
      }
    }
  }
  return first.slice(0, end).join('/');
}
