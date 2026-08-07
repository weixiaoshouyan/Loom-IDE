import { describe, expect, it } from 'vitest';
import { closeWorkspaceState, inferWorkspaceFromOpenFiles, upsertOpenFile } from './workspace-state';
import type { OpenFile } from './App';

const file = (path: string, content: string, originalContent = content): OpenFile => ({
  path,
  name: path.split(/[\\/]/).pop() || path,
  content,
  originalContent,
  language: 'plaintext',
});

describe('workspace-state', () => {
  it('refreshes an already-open clean file when the user clicks it again', () => {
    const result = upsertOpenFile([file('D:/demo/a.ts', '')], 0, 'D:/demo/a.ts', 'const x = 1;', 'typescript');

    expect(result.activeIdx).toBe(0);
    expect(result.openFiles[0]).toMatchObject({
      content: 'const x = 1;',
      originalContent: 'const x = 1;',
    });
  });

  it('focuses but does not overwrite unsaved edits in an already-open file', () => {
    const result = upsertOpenFile(
      [file('D:/demo/a.ts', 'unsaved edit', 'original')],
      0,
      'D:/demo/a.ts',
      'content from disk',
      'typescript',
    );

    expect(result.activeIdx).toBe(0);
    expect(result.openFiles[0].content).toBe('unsaved edit');
    expect(result.openFiles[0].originalContent).toBe('original');
  });

  it('clears files, selection, and workspace when closing a folder', () => {
    expect(closeWorkspaceState([file('D:/demo/a.ts', 'x')])).toEqual({
      openFiles: [],
      activeIdx: 0,
      selectedFile: '',
      workspace: '',
    });
  });

  it('infers a missing workspace from restored open files', () => {
    expect(inferWorkspaceFromOpenFiles([
      file('D:/demo/src/a.ts', 'a'),
      file('D:/demo/src/nested/b.ts', 'b'),
    ])).toBe('D:/demo/src');
  });

  it('ignores untitled files when inferring a workspace', () => {
    expect(inferWorkspaceFromOpenFiles([
      file('untitled-1', ''),
      file('D:/demo/src/a.ts', 'a'),
    ])).toBe('D:/demo/src');
  });
});
