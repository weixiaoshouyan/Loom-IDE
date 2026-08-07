import { describe, expect, it } from 'vitest';
import {
  approvePlan,
  cancelTask,
  createAgentTaskState,
  failTask,
  finishVerification,
  receivePlan,
  startPlanning,
  startVerification,
} from './agent-task-state';

describe('agent-task-state', () => {
  it('starts idle with no plan or verification result', () => {
    expect(createAgentTaskState()).toEqual({
      status: 'idle',
      plan: null,
      approvedPlan: null,
      verification: null,
      error: null,
    });
  });

  it('moves from planning to waiting for approval when a plan arrives', () => {
    const planning = startPlanning(createAgentTaskState());
    const next = receivePlan(planning, '1. inspect\n2. edit');

    expect(planning.status).toBe('planning');
    expect(next).toMatchObject({
      status: 'waiting_for_plan_approval',
      plan: '1. inspect\n2. edit',
      approvedPlan: null,
    });
  });

  it('approves a received plan and moves to running', () => {
    const waiting = receivePlan(createAgentTaskState(), 'Plan text');
    const running = approvePlan(waiting);

    expect(running).toMatchObject({
      status: 'running',
      plan: 'Plan text',
      approvedPlan: 'Plan text',
    });
  });

  it('stores verification command output and completion state', () => {
    const running = approvePlan(receivePlan(createAgentTaskState(), 'Plan text'));
    const verifying = startVerification(running, 'npm run test:run');
    const completed = finishVerification(verifying, 0, 'passed', '');

    expect(verifying).toMatchObject({
      status: 'verifying',
      verification: { command: 'npm run test:run', status: 'running' },
    });
    expect(completed).toMatchObject({
      status: 'completed',
      verification: { command: 'npm run test:run', status: 'passed', exitCode: 0, stdout: 'passed', stderr: '' },
    });
  });

  it('marks failed verification and explicit failures', () => {
    const verifying = startVerification(createAgentTaskState(), 'npm run lint');
    const failedVerification = finishVerification(verifying, 1, '', 'lint failed');
    const failedTask = failTask(createAgentTaskState(), 'model failed');

    expect(failedVerification.status).toBe('failed');
    expect(failedVerification.verification?.status).toBe('failed');
    expect(failedTask).toMatchObject({ status: 'failed', error: 'model failed' });
  });

  it('cancels the task while preserving existing plan text', () => {
    const waiting = receivePlan(createAgentTaskState(), 'Plan text');

    expect(cancelTask(waiting)).toMatchObject({
      status: 'cancelled',
      plan: 'Plan text',
    });
  });
});
