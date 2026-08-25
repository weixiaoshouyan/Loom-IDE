import React from 'react';
import type { AgentTaskState } from '../agent-task-state';
import { normalizeVerificationOutput } from '../agent-verification';
import { t } from '@/shared/i18n';

interface Props {
  task: AgentTaskState;
  /** 手动验证命令按钮；不传时以只读模式展示引擎自动验证结果。 */
  commands?: string[];
  customCommand?: string;
  disabled?: boolean;
  onCustomCommandChange?: (value: string) => void;
  onRun?: (command: string) => void;
}

export default function AgentVerificationPanel({
  task,
  commands = [],
  customCommand = '',
  disabled,
  onCustomCommandChange,
  onRun,
}: Props) {
  const verification = task.verification;
  const output = verification
    ? normalizeVerificationOutput([verification.stdout, verification.stderr].filter(Boolean).join('\n'))
    : '';
  const canRunCustom = customCommand.trim().length > 0 && !disabled && !!onRun;

  return (
    <div className={`agent-verification-panel ${verification ? `agent-verification-${verification.status}` : ''}`} data-testid="agent-verification-panel">
      <div className="agent-verification-header">
        <div>
          <div className="agent-verification-title">{t('agentVerification.title')}</div>
          <div className="agent-verification-subtitle">
            {verification?.status === 'running'
              ? t('agentVerification.runningHint')
              : verification
                ? t('agentVerification.resultHint')
                : t('agentVerification.manualHint')}
          </div>
        </div>
        {verification && (
          <span className="agent-verification-badge">
            {verification.status === 'running'
              ? t('agentVerification.running')
              : verification.status === 'passed'
                ? t('agentVerification.passed')
                : t('agentVerification.failed')}
          </span>
        )}
      </div>

      {commands.length > 0 && (
        <div className="agent-verification-actions">
          {commands.map(command => (
            <button
              key={command}
              type="button"
              className="agent-verification-command"
              disabled={disabled || !onRun}
              onClick={() => onRun?.(command)}
              title={command}
              aria-label={`${t('agentVerification.runCommand')} ${command}`}
              data-testid="agent-verification-command"
            >
              {command}
            </button>
          ))}
        </div>
      )}

      {onRun && onCustomCommandChange && (
        <div className="agent-verification-custom">
          <input
            value={customCommand}
            onChange={event => onCustomCommandChange(event.target.value)}
            placeholder={t('agentVerification.customPlaceholder')}
            disabled={disabled}
            aria-label={t('agentVerification.customPlaceholder')}
            data-testid="agent-verification-custom-input"
          />
          <button
            type="button"
            disabled={!canRunCustom}
            onClick={() => onRun(customCommand.trim())}
            aria-label={t('agentVerification.run')}
            data-testid="agent-verification-custom-run"
          >
            {t('agentVerification.run')}
          </button>
        </div>
      )}

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
