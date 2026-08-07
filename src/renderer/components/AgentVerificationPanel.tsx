import React from 'react';
import type { AgentTaskState } from '../agent-task-state';
import { normalizeVerificationOutput } from '../agent-verification';

interface Props {
  task: AgentTaskState;
  commands: string[];
  customCommand: string;
  disabled?: boolean;
  onCustomCommandChange: (value: string) => void;
  onRun: (command: string) => void;
}

export default function AgentVerificationPanel({
  task,
  commands,
  customCommand,
  disabled,
  onCustomCommandChange,
  onRun,
}: Props) {
  const verification = task.verification;
  const output = verification
    ? normalizeVerificationOutput([verification.stdout, verification.stderr].filter(Boolean).join('\n'))
    : '';
  const canRunCustom = customCommand.trim().length > 0 && !disabled;

  return (
    <div className={`agent-verification-panel ${verification ? `agent-verification-${verification.status}` : ''}`} data-testid="agent-verification-panel">
      <div className="agent-verification-header">
        <div>
          <div className="agent-verification-title">验证</div>
          <div className="agent-verification-subtitle">运行测试或 lint，把结果附到当前 Agent 任务。</div>
        </div>
        {verification && (
          <span className="agent-verification-badge">
            {verification.status === 'running' ? '运行中' : verification.status === 'passed' ? '通过' : '失败'}
          </span>
        )}
      </div>

      <div className="agent-verification-actions">
        {commands.map(command => (
          <button
            key={command}
            type="button"
            className="agent-verification-command"
            disabled={disabled}
            onClick={() => onRun(command)}
            title={command}
            aria-label={`运行验证命令 ${command}`}
            data-testid="agent-verification-command"
          >
            {command}
          </button>
        ))}
      </div>

      <div className="agent-verification-custom">
        <input
          value={customCommand}
          onChange={event => onCustomCommandChange(event.target.value)}
          placeholder="自定义验证命令，例如 npm run build"
          disabled={disabled}
          aria-label="自定义验证命令"
          data-testid="agent-verification-custom-input"
        />
        <button
          type="button"
          disabled={!canRunCustom}
          onClick={() => onRun(customCommand.trim())}
          aria-label="运行自定义验证命令"
          data-testid="agent-verification-custom-run"
        >
          运行
        </button>
      </div>

      {verification && (
        <div className="agent-verification-result">
          <div className="agent-verification-command-line">{verification.command}</div>
          <div className="agent-verification-meta">
            exitCode: {verification.exitCode ?? 'pending'}
          </div>
          {output && <pre>{output}</pre>}
        </div>
      )}
    </div>
  );
}
