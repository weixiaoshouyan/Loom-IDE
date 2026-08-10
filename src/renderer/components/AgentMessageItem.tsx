import React from 'react';
import { formatMarkdown } from '../markdown-renderer';
import type { AgentTaskState } from '../agent-task-state';

/**
 * 消息展示类型（与 AIAgent 内的 Message / ToolCallDisplay 结构兼容）。
 * 组件内部用 React.memo 保证：流式期间只有内容真正变化的那条消息会重渲染，
 * 其余历史消息（含 formatMarkdown 全文解析）全部跳过，避免 O(n²) 解析。
 */

export interface AgentToolCallDisplay {
  name: string;
  args?: unknown;
  status: 'pending' | 'running' | 'done' | 'error' | string;
  expanded?: boolean;
  result?: string;
}

export interface AgentMessageItemProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  isStreaming?: boolean;
  toolCalls?: AgentToolCallDisplay[];
  attachedFiles?: { path: string; name: string; content?: string }[];
  locale?: 'zh-CN' | 'en-US';
}

function AgentMessageItemBase({ role, content, isStreaming, toolCalls, attachedFiles, locale = 'zh-CN' }: AgentMessageItemProps) {
  const zh = locale === 'zh-CN';
  return (
    <div className={`ai-message ai-msg-${role} ${isStreaming ? 'streaming' : ''}`}>
      <div
        className="ai-message-content"
        dangerouslySetInnerHTML={{ __html: formatMarkdown(content || '') }}
      />
      {attachedFiles && attachedFiles.length > 0 && (
        <div className="ai-attached-files">
          {attachedFiles.map(file => (
            <span key={file.path} title={file.path}>@{file.name}</span>
          ))}
        </div>
      )}
      {toolCalls && toolCalls.length > 0 && (
        <details className="ai-operations-log" data-testid="ai-operations-log">
          <summary>
            <span>{zh ? '操作记录' : 'Operations'}</span>
            <strong>{toolCalls.length}</strong>
            <small>{zh ? '工具和命令输出已折叠' : 'tool & command output collapsed'}</small>
          </summary>
          <div className="ai-tool-calls">
            {toolCalls.map((tool, toolIndex) => (
              // 运行中的工具自动展开，让用户实时看到当前在做什么
              <details
                key={`${tool.name}-${toolIndex}`}
                className={`ai-tool-call ${tool.status}`}
                data-testid="ai-tool-call"
                open={tool.status === 'running' || tool.expanded}
              >
                <summary>
                  <span>
                    {tool.status === 'done' ? (zh ? '已完成' : 'done')
                      : tool.status === 'running' ? (zh ? '运行中' : 'running')
                        : tool.status === 'error' ? (zh ? '出错' : 'error') : tool.status}
                  </span>
                  <strong>{tool.name}</strong>
                </summary>
                <pre>{renderToolArgs(tool.args)}</pre>
                {tool.result && <pre>{tool.result}</pre>}
              </details>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function renderToolArgs(args?: unknown): string {
  if (args === undefined || args === null) return '';
  try {
    if (typeof args === 'string') return args;
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export const AgentMessageItem = React.memo(AgentMessageItemBase);

// ---------------------------------------------------------------------------
// Agent 运行状态条：运行中显示阶段/工具数/用量；结束后显示结果与「继续」按钮。
// ---------------------------------------------------------------------------

export function AgentRunStatus({
  task,
  usageText,
  toolCount,
  locale = 'zh-CN',
  onContinue,
}: {
  task: AgentTaskState;
  usageText: string;
  toolCount: number;
  locale?: 'zh-CN' | 'en-US';
  onContinue?: () => void;
}) {
  const zh = locale === 'zh-CN';
  const running = task.status === 'running' || task.status === 'planning'
    || task.status === 'reviewing' || task.status === 'verifying';

  if (running) {
    return (
      <div className="agent-run-status running" data-testid="agent-run-status">
        <span className="agent-run-spinner" aria-hidden="true" />
        <span className="agent-run-text">
          {task.status === 'planning' ? (zh ? '智能体正在制定计划…' : 'Agent is planning…')
            : task.status === 'reviewing' ? (zh ? '等待你审阅修改…' : 'Waiting for your review…')
              : task.status === 'verifying' ? (zh ? '正在运行验证（类型检查/测试）…' : 'Verifying (typecheck/tests)…')
                : (zh ? '智能体运行中…' : 'Agent is working…')}
        </span>
        {toolCount > 0 && <span className="agent-run-tools">{zh ? `已调用 ${toolCount} 个工具` : `${toolCount} tool calls`}</span>}
        {usageText && <span className="agent-run-usage">{usageText}</span>}
      </div>
    );
  }

  if (task.status === 'failed' || task.status === 'completed') {
    return (
      <div className={`agent-run-status ${task.status}`} data-testid="agent-run-status">
        <span className="agent-run-text">
          {task.status === 'failed'
            ? (zh ? `运行失败${task.error ? `：${task.error}` : ''}` : `Failed${task.error ? `: ${task.error}` : ''}`)
            : (zh ? '运行完成' : 'Completed')}
        </span>
        {usageText && <span className="agent-run-usage">{usageText}</span>}
        {onContinue && (
          <button type="button" className="agent-run-continue" onClick={onContinue} data-testid="ai-continue">
            {zh ? '继续' : 'Continue'}
          </button>
        )}
      </div>
    );
  }

  return null;
}
