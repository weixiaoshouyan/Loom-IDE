import React from 'react';
import type { AgentTaskState } from '../agent-task-state';

interface Props {
  task: AgentTaskState;
  onApprove: () => void;
  onCancel: () => void;
}

export default function AgentPlanApproval({ task, onApprove, onCancel }: Props) {
  if (task.status !== 'waiting_for_plan_approval' || !task.plan) return null;

  return (
    <div className="agent-plan-approval" aria-label="Agent plan approval">
      <div className="agent-plan-header">
        <div>
          <div className="agent-plan-eyebrow">Plan ready</div>
          <div className="agent-plan-title">Review before build</div>
        </div>
        <span className="agent-plan-status">Waiting</span>
      </div>
      <pre className="agent-plan-body">{task.plan}</pre>
      <div className="agent-plan-actions">
        <button className="agent-plan-cancel" onClick={onCancel}>Cancel</button>
        <button className="agent-plan-approve" onClick={onApprove}>Use plan in Build</button>
      </div>
    </div>
  );
}
