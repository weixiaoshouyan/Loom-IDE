import React from 'react';

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
  return '等待输出...';
}

function commandLine(task: AgentCommandTask): string {
  return [task.request.command, ...(task.request.args || [])].join(' ');
}

function statusLabel(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    queued: '排队中',
    running: '运行中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return map[status];
}

export default function AgentTaskCenter({ tasks, onRefresh, onCancel, onRetry, onClose }: Props) {
  const running = tasks.filter(task => task.status === 'running' || task.status === 'queued').length;

  return (
    <div className="agent-task-center" role="dialog" aria-label="Agent 任务中心" data-testid="agent-task-center">
      <div className="agent-task-center-header">
        <div>
          <div className="agent-task-center-title">任务中心</div>
          <div className="agent-task-center-subtitle">{running} 个运行中 / {tasks.length} 条历史</div>
        </div>
        <div className="agent-task-center-actions">
          <button type="button" onClick={onRefresh} aria-label="刷新任务中心" data-testid="agent-tasks-refresh">刷新</button>
          <button type="button" onClick={onClose} aria-label="关闭任务中心" data-testid="agent-tasks-close">关闭</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="agent-task-center-empty">
          还没有命令任务。让 Agent 运行测试、构建或 PowerShell 命令后，会出现在这里。
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
                <span>{task.history.length} 个事件</span>
                {typeof task.result?.exitCode !== 'undefined' && <span>退出码 {task.result?.exitCode ?? 'null'}</span>}
                {task.finishedAt && <span>{new Date(task.finishedAt).toLocaleTimeString()}</span>}
              </div>
              <div className="agent-task-actions">
                {(task.status === 'queued' || task.status === 'running') && (
                  <button type="button" onClick={() => onCancel(task.id)} data-testid="agent-task-cancel" aria-label={`取消 ${commandLine(task)}`}>
                    取消
                  </button>
                )}
                {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'succeeded') && (
                  <button type="button" onClick={() => onRetry(task.id)} data-testid="agent-task-retry" aria-label={`重试 ${commandLine(task)}`}>
                    重试
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
