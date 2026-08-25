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

/**
 * 引擎自动验证（verify mode）进度：进入验证阶段但保持任务未完成。
 * 与 startVerification 的区别：完成后把状态恢复为 running（引擎还会继续修），
 * 而不是直接置为 completed/failed。
 */
export function setVerifying(state: AgentTaskState, command: string): AgentTaskState {
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
  };
}

export function setVerificationResult(
  state: AgentTaskState,
  passed: boolean,
  exitCode: number | null,
  output: string,
): AgentTaskState {
  return {
    ...state,
    // 引擎侧验证失败后会继续修复，任务并未终结；保持 running 而非 failed。
    status: state.status === 'verifying' ? 'running' : state.status,
    verification: {
      command: state.verification?.command || 'verification',
      startedAt: state.verification?.startedAt || Date.now(),
      status: passed ? 'passed' : 'failed',
      exitCode,
      stdout: output,
      stderr: '',
      finishedAt: Date.now(),
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
