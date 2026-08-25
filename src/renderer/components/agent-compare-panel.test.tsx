// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentComparePanel from './AgentComparePanel';
import { setLocale } from '@/shared/i18n';

setLocale('zh-CN');

describe('AgentComparePanel', () => {
  it('renders both model columns with vote buttons wired to onVote', () => {
    const onVote = vi.fn();
    render(
      <AgentComparePanel
        labelA="DeepSeek"
        labelB="GLM"
        votes={{ a: 0, b: 0 }}
        onVote={onVote}
        running={false}
        error={null}
        result={null}
      />,
    );
    expect(screen.getByTestId('ai-compare-vote-a')).toBeTruthy();
    const btnB = screen.getByTestId('ai-compare-vote-b') as HTMLButtonElement;
    fireEvent.click(btnB);
    expect(onVote).toHaveBeenCalledWith('b');
  });

  it('shows the empty hint while idle and the loading state while running', () => {
    const { rerender } = render(
      <AgentComparePanel labelA="A" labelB="B" votes={{ a: 0, b: 0 }} onVote={() => {}} running={false} error={null} result={null} />,
    );
    expect(screen.getAllByText(/选择两个模型后发送/).length).toBe(2);

    rerender(
      <AgentComparePanel labelA="A" labelB="B" votes={{ a: 0, b: 0 }} onVote={() => {}} running={true} error={null} result={null} />,
    );
    expect(screen.getAllByText('生成中…').length).toBe(2);
  });

  it('surfaces request errors and the localized vote summary with winner', () => {
    render(
      <AgentComparePanel
        labelA="A"
        labelB="B"
        votes={{ a: 2, b: 1 }}
        onVote={() => {}}
        running={false}
        error={null}
        result={{
          a: { text: 'answer A', usage: null },
          b: { text: 'answer B', usage: null },
        }}
      />,
    );
    expect(screen.getByText(/投票结果：A 2 票 · B 1 票/)).toBeTruthy();
    expect(screen.getByText(/· A 胜出/)).toBeTruthy();
  });
});
