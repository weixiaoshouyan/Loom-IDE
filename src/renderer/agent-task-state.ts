export type AgentTaskStatus =
  | 'idle'
  | 'planning'
  | 'waiting_for_plan_approval'
  | 'running'
  | 'reviewing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentVerificationStatus = 'running' | 'passed' | 'failed';

export interface AgentVerificationResult {
  command: string;
  status: AgentVerificationStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface AgentTaskState {
  status: AgentTaskStatus;
  plan: string | null;
  approvedPlan: string | null;
  verification: AgentVerificationResult | null;
  error: string | null;
}

export function createAgentTaskState(): AgentTaskState {
  return {
    status: 'idle',
    plan: null,
    approvedPlan: null,
    verification: null,
    error: null,
  };
}

export function startPlanning(state: AgentTaskState): AgentTaskState {
  return {
    ...state,
    status: 'planning',
    error: null,
  };
}

export function receivePlan(state: AgentTaskState, plan: string): AgentTaskState {
  return {
    ...state,
    status: 'waiting_for_plan_approval',
    plan,
    approvedPlan: null,
    error: null,
  };
}

export function approvePlan(state: AgentTaskState): AgentTaskState {
  return {
    ...state,
    status: 'running',
    approvedPlan: state.plan,
    error: null,
  };
}

export function startVerification(state: AgentTaskState, command: string): AgentTaskState {
  return {
    ...state,
    status: 'verifying',
    verification: {
      command,
      status: 'running',
      exitCode: null,
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
      finishedAt: null,
    },
    error: null,
  };
}

export function finishVerification(
  state: AgentTaskState,
  exitCode: number,
  stdout: string,
  stderr: string,
): AgentTaskState {
  const passed = exitCode === 0;
  return {
    ...state,
    status: passed ? 'completed' : 'failed',
    verification: {
      command: state.verification?.command || '',
      startedAt: state.verification?.startedAt || Date.now(),
      status: passed ? 'passed' : 'failed',
      exitCode,
      stdout,
      stderr,
      finishedAt: Date.now(),
    },
    error: passed ? null : stderr || stdout || `Verification failed with exit code ${exitCode}`,
  };
}

export function failTask(state: AgentTaskState, error: string): AgentTaskState {
  return {
    ...state,
    status: 'failed',
    error,
  };
}

export function cancelTask(state: AgentTaskState): AgentTaskState {
  return {
    ...state,
    status: 'cancelled',
  };
}
