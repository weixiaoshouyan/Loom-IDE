// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentHistoryPanel from './AgentHistoryPanel';
import type { ChatSession } from './AIAgent';
import { setLocale } from '@/shared/i18n';

setLocale('zh-CN');

function session(partial: Partial<ChatSession>): ChatSession {
  const base = {
    id: 's1',
    title: 'Fix bug',
    preview: 'last message',
    updatedAt: Date.now(),
    messages: [] as ChatSession['messages'],
  };
  return { ...base, ...partial } as ChatSession;
}

describe('AgentHistoryPanel', () => {
  it('lists sessions with title and preview, restoring on click', () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    const s = session({ id: 's9', title: 'Refactor', preview: 'done' });
    render(<AgentHistoryPanel sessions={[s]} onRestore={onRestore} onDelete={onDelete} onClose={() => {}} />);

    fireEvent.click(screen.getByText('Refactor'));
    expect(onRestore).toHaveBeenCalledWith(s);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows the empty hint when no sessions exist', () => {
    render(<AgentHistoryPanel sessions={[]} onRestore={() => {}} onDelete={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/暂无历史对话/)).toBeTruthy();
  });

  it('falls back to the no-summary placeholder and deletes via the dedicated control', () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    render(
      <AgentHistoryPanel
        sessions={[session({ id: 'sx', title: 'T', preview: '' })]}
        onRestore={onRestore}
        onDelete={onDelete}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('无摘要')).toBeTruthy();

    const del = screen.getByLabelText('删除历史对话 T');
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith('sx');
  });
});
