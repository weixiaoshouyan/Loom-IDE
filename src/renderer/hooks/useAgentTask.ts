/**
 * useAgentTask — Agent 任务状态机 hook（AIAgent.tsx 拆出的领域模块）。
 *
 * 封装 AgentTaskState（agent-task-state 的纯 reducer 集合）为可复用的 hook：
 * 计划审批 / 运行 / 审阅 / 验证 / 失败 / 取消 的状态流转全部收敛于此，
 * 组件只消费状态与命名操作，不再直接拼装 setAgentTask。
 */
import { useCallback, useState } from 'react';
import {
  approvePlan,
  cancelTask,
  createAgentTaskState,
  failTask,
  receivePlan,
  setVerificationResult,
  setVerifying,
  startPlanning,
  type AgentTaskState,
} from '../agent-task-state';

export function useAgentTask() {
  const [agentTask, setAgentTask] = useState<AgentTaskState>(createAgentTaskState());

  const setTask = useCallback((updater: (prev: AgentTaskState) => AgentTaskState) => {
    setAgentTask(updater);
  }, []);

  /** 通用状态覆盖（组件内部少数直接流转用）。 */
  const patchStatus = useCallback((status: AgentTaskState['status']) => {
    setAgentTask(prev => ({ ...prev, status }));
  }, []);

  const startPlanningTask = useCallback(() => {
    setAgentTask(prev => startPlanning(prev));
  }, []);

  const receivePlanTask = useCallback((plan: string) => {
    setAgentTask(prev => receivePlan(prev, plan));
  }, []);

  const approvePlanTask = useCallback(() => {
    setAgentTask(prev => approvePlan(prev));
  }, []);

  const failTaskWith = useCallback((error: string) => {
    setAgentTask(prev => failTask(prev, error));
  }, []);

  const cancelTaskNow = useCallback(() => {
    setAgentTask(prev => cancelTask(prev));
  }, []);

  const markVerifying = useCallback((command: string) => {
    setAgentTask(prev => setVerifying(prev, command));
  }, []);

  const markVerificationResult = useCallback((passed: boolean, exitCode: number | null, output: string) => {
    setAgentTask(prev => setVerificationResult(prev, passed, exitCode, output));
  }, []);

  const resetTask = useCallback(() => {
    setAgentTask(createAgentTaskState());
  }, []);

  const markRunning = useCallback(() => {
    setAgentTask(prev => ({ ...prev, status: 'running', error: null }));
  }, []);

  const markCompleted = useCallback(() => {
    setAgentTask(prev => prev.status === 'running' || prev.status === 'planning'
      ? { ...prev, status: 'completed' }
      : prev);
  }, []);

  const markReviewing = useCallback(() => {
    setAgentTask(prev => ({ ...prev, status: 'reviewing' }));
  }, []);

  return {
    agentTask,
    setTask,
    patchStatus,
    startPlanningTask,
    receivePlanTask,
    approvePlanTask,
    failTaskWith,
    cancelTaskNow,
    markVerifying,
    markVerificationResult,
    resetTask,
    markRunning,
    markCompleted,
    markReviewing,
  };
}
