import React from 'react';
import type { AgentTaskState } from '../agent-task-state';

interface Props {
  task: AgentTaskState;
  onApprove: () => void;
  onCancel: () => void;
  locale?: 'zh-CN' | 'en-US';
}

export default function AgentPlanApproval({ task, onApprove, onCancel, locale = 'zh-CN' }: Props) {
  if (task.status !== 'waiting_for_plan_approval' || !task.plan) return null;
  const zh = locale === 'zh-CN';

  return (
    <div className="agent-plan-approval" aria-label={zh ? 'Agent 计划审批' : 'Agent plan approval'}>
      <div className="agent-plan-header">
        <div>
          <div className="agent-plan-eyebrow">{zh ? '计划已就绪' : 'Plan ready'}</div>
          <div className="agent-plan-title">{zh ? '构建前请审阅' : 'Review before build'}</div>
        </div>
        <span className="agent-plan-status">{zh ? '等待确认' : 'Waiting'}</span>
      </div>
      <pre className="agent-plan-body">{task.plan}</pre>
      <div className="agent-plan-actions">
        <button className="agent-plan-cancel" onClick={onCancel}>{zh ? '取消' : 'Cancel'}</button>
        <button className="agent-plan-approve" onClick={onApprove}>{zh ? '按计划执行' : 'Use plan in Build'}</button>
      </div>
    </div>
  );
}
