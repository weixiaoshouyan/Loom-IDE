import React from 'react';
import type { ChatSession } from './AIAgent';

interface Props {
  sessions: ChatSession[];
  onRestore: (session: ChatSession) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** 历史对话列表面板——从 AIAgent.tsx 抽出，降低巨型组件体量。 */
export default function AgentHistoryPanel({ sessions, onRestore, onDelete, onClose }: Props) {
  return (
    <div className="ai-history-panel" data-testid="ai-history-panel">
      <div className="ai-history-header">
        <div className="ai-history-title">历史对话</div>
        <div className="ai-history-count">{sessions.length}</div>
        <button type="button" className="ai-history-close" aria-label="关闭历史对话" onClick={onClose}>
          x
        </button>
      </div>
      <div className="ai-history-list">
        {sessions.length === 0 ? (
          <div className="ai-history-empty">暂无历史对话。完成一次对话后会自动保存到这里。</div>
        ) : (
          sessions.map(session => (
            <button
              key={session.id}
              type="button"
              className="ai-history-item"
              data-testid="ai-history-item"
              onClick={() => onRestore(session)}
            >
              <span className="ai-history-item-icon">#</span>
              <span className="ai-history-item-body">
                <span className="ai-history-item-name">{session.title}</span>
                <span className="ai-history-item-preview">{session.preview || '无摘要'}</span>
                <span className="ai-history-item-meta">
                  {new Date(session.updatedAt).toLocaleString()}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                className="ai-history-item-delete"
                aria-label={`删除历史对话 ${session.title}`}
                onClick={event => {
                  event.stopPropagation();
                  onDelete(session.id);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(session.id);
                  }
                }}
              >
                x
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
