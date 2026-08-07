import React from 'react';
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
  return (
    <div className="ai-compare-panel">
      <div className="ai-compare-cols">
        <div className="ai-compare-col">
          <div className="ai-compare-head">
            <span className="ai-compare-name">{labelA || '模型 A'}</span>
            {votes.a > 0 && <span className="ai-compare-votecount">👍 {votes.a}</span>}
          </div>
          <button type="button" className="ai-compare-vote" data-testid="ai-compare-vote-a" onClick={() => onVote('a')}>👍 投票</button>
          <div className="ai-compare-body">
            {error ? <span className="ai-compare-error">{error}</span>
              : result ? (result.a.text
                ? <div dangerouslySetInnerHTML={{ __html: formatMarkdown(result.a.text) }} />
                : (running ? <span className="ai-compare-loading">生成中…</span> : <div className="ai-compare-empty">选择两个模型后发送，并排对比它们的回答。</div>))
              : (running ? <span className="ai-compare-loading">生成中…</span> : <div className="ai-compare-empty">选择两个模型后发送，并排对比它们的回答。</div>)}
          </div>
          {result && <div className="ai-compare-usage">{formatUsage(result.a.usage)}</div>}
        </div>
        <div className="ai-compare-col">
          <div className="ai-compare-head">
            <span className="ai-compare-name">{labelB || '模型 B'}</span>
            {votes.b > 0 && <span className="ai-compare-votecount">👍 {votes.b}</span>}
          </div>
          <button type="button" className="ai-compare-vote" data-testid="ai-compare-vote-b" onClick={() => onVote('b')}>👍 投票</button>
          <div className="ai-compare-body">
            {error ? <span className="ai-compare-error">{error}</span>
              : result ? (result.b.text
                ? <div dangerouslySetInnerHTML={{ __html: formatMarkdown(result.b.text) }} />
                : (running ? <span className="ai-compare-loading">生成中…</span> : <div className="ai-compare-empty">选择两个模型后发送，并排对比它们的回答。</div>))
              : (running ? <span className="ai-compare-loading">生成中…</span> : <div className="ai-compare-empty">选择两个模型后发送，并排对比它们的回答。</div>)}
          </div>
          {result && <div className="ai-compare-usage">{formatUsage(result.b.usage)}</div>}
        </div>
      </div>
      {result && (votes.a > 0 || votes.b > 0) && (
        <div className="ai-compare-summary">
          投票结果：{labelA} {votes.a} 票 · {labelB} {votes.b} 票
          {votes.a !== votes.b
            ? ` · ${votes.a > votes.b ? labelA : labelB} 胜出`
            : ' · 平局'}
        </div>
      )}
    </div>
  );
}
