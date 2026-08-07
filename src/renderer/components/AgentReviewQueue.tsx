import React from 'react';
import type { AgentReviewItem } from '../agent-review-queue';

interface Props {
  items: AgentReviewItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function changeStats(item: AgentReviewItem): { added: number; removed: number } {
  const original = item.original.split('\n');
  const modified = item.modified.split('\n');
  return {
    added: Math.max(0, modified.length - original.length),
    removed: Math.max(0, original.length - modified.length),
  };
}

export default function AgentReviewQueue({ items, selectedId, onSelect, onAccept, onReject }: Props) {
  const pending = items.filter(item => item.status === 'pending').length;
  if (items.length === 0) return null;

  return (
    <div className="agent-review-queue" aria-label="Agent review queue">
      <div className="agent-review-header">
        <span className="agent-review-title">Review changes</span>
        <span className="agent-review-count">{pending} pending</span>
      </div>
      <div className="agent-review-list">
        {items.map((item, index) => {
          const stats = changeStats(item);
          const selected = selectedId === item.id;
          return (
            <div
              key={`${item.id}-${item.status}-${index}`}
              className={`agent-review-item ${item.status} ${selected ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(item.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(item.id);
              }}
              title={item.filePath}
            >
              <div className="agent-review-item-main">
                <span className="agent-review-status-dot" />
                <span className="agent-review-file">{basename(item.filePath)}</span>
                {!item.existed && <span className="agent-review-new">new</span>}
              </div>
              <div className="agent-review-meta">
                <span className="agent-review-stats">+{stats.added} -{stats.removed}</span>
                <span className="agent-review-state">{item.status}</span>
              </div>
              {item.status === 'pending' && (
                <div className="agent-review-actions">
                  <button
                    type="button"
                    className="agent-review-reject"
                    aria-label={`Reject ${basename(item.filePath)}`}
                    data-testid="agent-review-reject"
                    onClick={event => {
                      event.stopPropagation();
                      onReject(item.id);
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="agent-review-accept"
                    aria-label={`Accept ${basename(item.filePath)}`}
                    data-testid="agent-review-accept"
                    onClick={event => {
                      event.stopPropagation();
                      onAccept(item.id);
                    }}
                  >
                    Accept
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
