import React from 'react';
import { t } from '@/shared/i18n';

type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface TaskEvent {
  type: string;
  data?: string;
  error?: string;
  exitCode?: number | null;
  timestamp?: string;
}

interface AgentCommandTask {
  id: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: { command: string; args: string[]; cwd: string };
  history: TaskEvent[];
  result?: { exitCode: number | null; stdout?: string; stderr?: string; error?: string };
}

interface Props {
  tasks: AgentCommandTask[];
  onRefresh: () => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onClose: () => void;
}

function summarize(task: AgentCommandTask): string {
  const latestOutput = [...task.history].reverse().find(event => event.data || event.error);
  if (latestOutput?.error) return latestOutput.error;
  if (latestOutput?.data) return latestOutput.data.trim().slice(0, 180);
  if (task.result?.error) return task.result.error;
  if (task.result?.stderr) return task.result.stderr.trim().slice(0, 180);
  if (task.result?.stdout) return task.result.stdout.trim().slice(0, 180);
  return t('agentTaskCenter.waitingOutput');
}

function commandLine(task: AgentCommandTask): string {
  return [task.request.command, ...(task.request.args || [])].join(' ');
}

function statusLabel(status: TaskStatus): string {
  return t(`agentTaskCenter.${status}`);
}

export default function AgentTaskCenter({ tasks, onRefresh, onCancel, onRetry, onClose }: Props) {
  const running = tasks.filter(task => task.status === 'running' || task.status === 'queued').length;

  return (
    <div className="agent-task-center" role="dialog" aria-label={t('agentTaskCenter.agentTaskCenterAria')} data-testid="agent-task-center">
      <div className="agent-task-center-header">
        <div>
          <div className="agent-task-center-title">{t('agentTaskCenter.title')}</div>
          <div className="agent-task-center-subtitle">{t('agentTaskCenter.subtitleRunning', { running, total: tasks.length })}</div>
        </div>
        <div className="agent-task-center-actions">
          <button type="button" onClick={onRefresh} aria-label={t('agentTaskCenter.refreshAria')} data-testid="agent-tasks-refresh">{t('agentTaskCenter.refresh')}</button>
          <button type="button" onClick={onClose} aria-label={t('agentTaskCenter.closeAria')} data-testid="agent-tasks-close">{t('agentTaskCenter.close')}</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="agent-task-center-empty">
          {t('agentTaskCenter.empty')}
        </div>
      ) : (
        <div className="agent-task-list">
          {tasks.map(task => (
            <div key={task.id} className={`agent-task-item agent-task-${task.status}`} data-testid="agent-task-item">
              <div className="agent-task-row">
                <span className="agent-task-status">{statusLabel(task.status)}</span>
                <span className="agent-task-command" title={commandLine(task)}>{commandLine(task)}</span>
              </div>
              <div className="agent-task-summary">{summarize(task)}</div>
              <div className="agent-task-meta">
                <span>{t('agentTaskCenter.eventCount', { count: task.history.length })}</span>
                {typeof task.result?.exitCode !== 'undefined' && <span>exit {task.result?.exitCode ?? 'null'}</span>}
                {task.finishedAt && <span>{new Date(task.finishedAt).toLocaleTimeString()}</span>}
              </div>
              <div className="agent-task-actions">
                {(task.status === 'queued' || task.status === 'running') && (
                  <button type="button" onClick={() => onCancel(task.id)} data-testid="agent-task-cancel" aria-label={t('agentTaskCenter.cancelAria', { cmd: commandLine(task) })}>
                    {t('agentTaskCenter.cancel')}
                  </button>
                )}
                {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'succeeded') && (
                  <button type="button" onClick={() => onRetry(task.id)} data-testid="agent-task-retry" aria-label={t('agentTaskCenter.retryAria', { cmd: commandLine(task) })}>
                    {t('agentTaskCenter.retry')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
