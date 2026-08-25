// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from './TabBar';
import type { OpenFile } from '../App';

vi.mock('../loom-ipc', () => ({ getLoom: () => null }));

function file(partial: Partial<OpenFile> & { path: string }): OpenFile {
  return {
    name: partial.path.split(/[\\/]/).pop() || partial.path,
    content: '',
    language: 'plaintext',
    originalContent: '',
    ...partial,
  };
}

function renderBar(files: OpenFile[], activeIdx = 0) {
  return render(
    <TabBar
      files={files}
      activeIdx={activeIdx}
      onSelect={() => {}}
      onClose={() => {}}
      onCloseAll={() => {}}
      onCloseOthers={() => {}}
      onReorder={() => {}}
      onRun={() => {}}
      onSplit={() => {}}
      onRevert={() => {}}
      onPin={() => {}}
      locale="zh-CN"
    />,
  );
}

describe('TabBar', () => {
  it('renders one tab per open file with names', () => {
    renderBar([file({ path: 'C:/w/a.ts' }), file({ path: 'C:/w/b.md' })]);
    expect(screen.getByText('a.ts')).toBeTruthy();
    expect(screen.getByText('b.md')).toBeTruthy();
  });

  it('shows the modified indicator using the incremental dirty flag', () => {
    const { container } = renderBar([file({ path: 'C:/w/a.ts', dirty: true })]);
    expect(container.querySelector('.tab-modified')).toBeTruthy();
  });

  it('falls back to content comparison when the dirty flag is absent (legacy sessions)', () => {
    const { container } = renderBar([file({ path: 'C:/w/a.ts', content: 'changed', originalContent: 'base' })]);
    expect(container.querySelector('.tab-modified')).toBeTruthy();

    const clean = renderBar([file({ path: 'C:/w/clean.ts' })]);
    expect(clean.container.querySelector('.tab-modified')).toBeNull();
  });

  it('highlights the active tab and exposes tab semantics', () => {
    renderBar([file({ path: 'C:/w/a.ts' }), file({ path: 'C:/w/b.md' })], 1);
    const tabs = document.querySelectorAll('.tab');
    expect(tabs[0]!.className).not.toContain('active');
    expect(tabs[1]!.className).toContain('active');
    expect(tabs[1]!.getAttribute('role')).toBe('tab');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
  });
});
