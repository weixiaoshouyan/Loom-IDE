// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentTaskCenter from './AgentTaskCenter';
import type { ReactElement } from 'react';
import { setLocale } from '@/shared/i18n';

setLocale('zh-CN');
vi.mock('../loom-ipc', () => ({ getLoom: () => null }));

function makeTask(overrides: Partial<Parameters<typeof AgentTaskCenter>[0]['tasks'][number]> = {}) {
  return {
    id: 't1',
    status: 'running' as const,
    createdAt: new Date().toISOString(),
    request: { command: 'npm', args: ['test'], cwd: '.' },
    history: [{ type: 'stdout', data: 'hello' }],
    result: undefined,
    ...overrides,
  };
}

function renderCenter(tasks = [makeTask()]): { onRetry: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onRetry = vi.fn();
  const onCancel = vi.fn();
  const ui: ReactElement = (
    <AgentTaskCenter tasks={tasks} onRefresh={() => {}} onCancel={onCancel} onRetry={onRetry} onClose={() => {}} />
  );
  render(ui);
  return { onRetry, onCancel };
}

describe('AgentTaskCenter', () => {
  it('renders the localized title and task command', () => {
    renderCenter();
    expect(screen.getByText('任务中心')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();
  });

  it('shows the empty-state hint when no tasks exist', () => {
    renderCenter([]);
    expect(screen.getByText(/还没有命令任务/)).toBeTruthy();
  });

  it('offers cancel for running and retry for finished tasks with ids wired up', () => {
    const running = makeTask({ id: 'run-1' });
    const failed = makeTask({ id: 'fail-1', status: 'failed' as const });
    const { onCancel, onRetry } = renderCenter([running, failed]);

    fireEvent.click(screen.getByTestId('agent-task-cancel'));
    expect(onCancel).toHaveBeenCalledWith('run-1');

    fireEvent.click(screen.getByTestId('agent-task-retry'));
    expect(onRetry).toHaveBeenCalledWith('fail-1');
  });
});
