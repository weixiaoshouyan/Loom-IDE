/**
 * Loom Background Agent
 *
 * Runs Agent tasks in a non-blocking manner using a dedicated
 * async queue. The UI can continue to be used while the Agent
 * works in the background. Progress is reported via callbacks.
 */

import { AIEngine, type ChatMessage } from './ai-engine';
import type { ToolExecutionContext } from './agent-tools';

export interface BackgroundAgentTask {
  id: string;
  messages: ChatMessage[];
  toolContext: ToolExecutionContext;
  options?: {
    plannerMode?: boolean;
    planOnly?: boolean;
    verifyMode?: boolean;
    enableReflection?: boolean;
    tokenBudget?: number;
  };
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: {
    round: number;
    totalRounds: number;
    lastEvent?: string;
  };
  result?: { success: boolean; summary: string; error?: string };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export type BackgroundAgentCallback = (task: BackgroundAgentTask, event: { type: string; content: string }) => void;

export class BackgroundAgentManager {
  private tasks: Map<string, BackgroundAgentTask> = new Map();
  private running: Set<string> = new Set();
  private maxConcurrent: number;
  private onEvent?: BackgroundAgentCallback;
  private engine?: AIEngine;

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = maxConcurrent;
  }

  setEngine(engine: AIEngine): void {
    this.engine = engine;
  }

  onEventCallback(cb: BackgroundAgentCallback): void {
    this.onEvent = cb;
  }

  /**
   * Enqueue a new background agent task.
   * Returns the task ID immediately.
   */
  enqueue(
    messages: ChatMessage[],
    toolContext: ToolExecutionContext,
    options?: BackgroundAgentTask['options'],
  ): string {
    const id = `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const task: BackgroundAgentTask = {
      id,
      messages,
      toolContext,
      options,
      status: 'queued',
      createdAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.processQueue();
    return id;
  }

  /**
   * Cancel a running or queued task.
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'queued') {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      return true;
    }
    if (task.status === 'running') {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get task status.
   */
  getTask(taskId: string): BackgroundAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * List all tasks (newest first).
   */
  listTasks(): BackgroundAgentTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Process the queue — start tasks if capacity allows.
   */
  private processQueue(): void {
    if (!this.engine) return;

    const running = [...this.running].filter(id => {
      const t = this.tasks.get(id);
      return t?.status === 'running';
    });
    this.running = new Set(running);

    if (this.running.size >= this.maxConcurrent) return;

    const queued = [...this.tasks.values()]
      .filter(t => t.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const task of queued) {
      if (this.running.size >= this.maxConcurrent) break;
      this.runTask(task);
    }
  }

  /**
   * Run a single task in the background.
   */
  private async runTask(task: BackgroundAgentTask): Promise<void> {
    if (!this.engine) return;

    task.status = 'running';
    task.startedAt = Date.now();
    this.running.add(task.id);

    const events: string[] = [];
    let lastText = '';

    try {
      const stream = this.engine.agentChatStream(
        task.messages,
        task.toolContext,
        task.options?.enableReflection !== false ? 15 : 10,
        task.toolContext.abortSignal,
        task.options,
      );

      for await (const chunk of stream) {
        if ((task.status as string) === 'cancelled') break;

        if (chunk.type === 'text') {
          lastText = chunk.content;
        }
        if (chunk.type === 'state') {
          try {
            const state = JSON.parse(chunk.content);
            task.progress = { round: state.round, totalRounds: state.totalRounds };
          } catch { /* skip */ }
        }

        events.push(`${chunk.type}: ${chunk.content.slice(0, 100)}`);
        this.onEvent?.(task, chunk);
      }

      if ((task.status as string) !== 'cancelled') {
        task.status = 'completed';
        task.result = { success: true, summary: lastText.slice(0, 500) };
      }
    } catch (e: any) {
      task.status = 'failed';
      task.result = { success: false, summary: '', error: e.message };
    } finally {
      task.completedAt = Date.now();
      this.running.delete(task.id);
      this.processQueue(); // Start next queued task
    }
  }

  /**
   * Clean up completed tasks older than the given age.
   */
  cleanup(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.completedAt && task.completedAt < cutoff) {
        this.tasks.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
