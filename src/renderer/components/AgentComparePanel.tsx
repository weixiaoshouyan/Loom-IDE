import React from 'react';
import { t } from '@/shared/i18n';
import { formatMarkdown } from '../markdown-renderer';
import { formatUsage } from '../ai-usage';

export interface CompareSide {
  text: string;
  usage: { input?: number; output?: number } | null;
}

export interface CompareResult {
  a: CompareSide;
  b: CompareSide;
}

interface Props {
  labelA: string;
  labelB: string;
  votes: { a: number; b: number };
  onVote: (side: 'a' | 'b') => void;
  running: boolean;
  error: string | null;
  result: CompareResult | null;
}

/** 模型并排对比面板——从 AIAgent.tsx 抽出。 */
export default function AgentComparePanel({ labelA, labelB, votes, onVote, running, error, result }: Props) {
  const emptyOrLoading = (side: 'a' | 'b') => (
    running
      ? <span className="ai-compare-loading">{t('agentCompare.generating')}</span>
      : <div className="ai-compare-empty">{t('agentCompare.emptyHint')}</div>
  );
  const body = (side: 'a' | 'b') => {
    const resultSide = result ? result[side] : null;
    return error ? <span className="ai-compare-error">{error}</span>
      : result ? (resultSide?.text
        ? <div dangerouslySetInnerHTML={{ __html: formatMarkdown(resultSide.text) }} />
        : emptyOrLoading(side))
      : emptyOrLoading(side);
  };
  return (
    <div className="ai-compare-panel">
      <div className="ai-compare-cols">
        <div className="ai-compare-col">
          <div className="ai-compare-head">
            <span className="ai-compare-name">{labelA || t('agentCompare.modelA')}</span>
            {votes.a > 0 && <span className="ai-compare-votecount">👍 {votes.a}</span>}
          </div>
          <button type="button" className="ai-compare-vote" data-testid="ai-compare-vote-a" onClick={() => onVote('a')}>👍 {t('agentCompare.vote')}</button>
          <div className="ai-compare-body">{body('a')}</div>
          {result && <div className="ai-compare-usage">{formatUsage(result.a.usage)}</div>}
        </div>
        <div className="ai-compare-col">
          <div className="ai-compare-head">
            <span className="ai-compare-name">{labelB || t('agentCompare.modelB')}</span>
            {votes.b > 0 && <span className="ai-compare-votecount">👍 {votes.b}</span>}
          </div>
          <button type="button" className="ai-compare-vote" data-testid="ai-compare-vote-b" onClick={() => onVote('b')}>👍 {t('agentCompare.vote')}</button>
          <div className="ai-compare-body">{body('b')}</div>
          {result && <div className="ai-compare-usage">{formatUsage(result.b.usage)}</div>}
        </div>
      </div>
      {result && (votes.a > 0 || votes.b > 0) && (
        <div className="ai-compare-summary">
          {t('agentCompare.voteResult', { labelA, votesA: votes.a, labelB, votesB: votes.b })}
          {votes.a !== votes.b
            ? ` · ${votes.a > votes.b ? labelA : labelB} ${t('agentCompare.winner')}`
            : ` · ${t('agentCompare.tie')}`}
        </div>
      )}
    </div>
  );
}
