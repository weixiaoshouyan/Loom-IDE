/**
 * Loom Agent Checkpoint / Resume
 *
 * Serializes the full Agent run state (conversation, scratchpad,
 * state machine snapshot) to disk so a long-running Agent can be
 * resumed after a crash, timeout, or network interruption.
 */

import fs from 'fs';
import path from 'path';
import type { ChatMessage } from './ai-engine';
import type { AgentStateSnapshot } from './agent-state-machine';

export interface AgentCheckpoint {
  id: string;
  version: 1;
  createdAt: number;
  workspacePath: string;
  messages: ChatMessage[];
  scratchpad: Record<string, string>;
  state: AgentStateSnapshot;
  streamId?: string;
}

export class CheckpointManager {
  private checkpointDir: string;

  constructor(workspacePath: string) {
    this.checkpointDir = path.join(workspacePath, '.loom', 'agent-checkpoints');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  save(checkpoint: AgentCheckpoint): string {
    this.ensureDir();
    const filePath = path.join(this.checkpointDir, `${checkpoint.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Retention policy: keep only the `maxCount` newest checkpoints (LRU by
   * creation time) and drop anything older than `maxAgeMs`. Called after every
   * save — without this the checkpoint dir grows without bound (each agent run
   * can dump hundreds of KB of conversation + tool output to disk).
   */
  prune(maxCount = 10, maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    if (!fs.existsSync(this.checkpointDir)) return 0;
    let removed = 0;
    try {
      const entries = this.list();
      const cutoff = Date.now() - maxAgeMs;
      for (const c of entries.slice(maxCount)) {
        if (this.delete(c.id)) removed++;
      }
      for (const c of entries) {
        if (c.createdAt < cutoff && this.delete(c.id)) removed++;
      }
    } catch { /* best-effort */ }
    return removed;
  }

  load(checkpointId: string): AgentCheckpoint | null {
    const filePath = path.join(this.checkpointDir, `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentCheckpoint;
    } catch {
      return null;
    }
  }

  /** Return the most recent checkpoint, or null if none exist */
  loadLatest(): AgentCheckpoint | null {
    const entries = this.list();
    if (entries.length === 0) return null;
    return entries[0];
  }

  /** List checkpoints sorted by creation time (newest first) */
  list(): AgentCheckpoint[] {
    if (!fs.existsSync(this.checkpointDir)) return [];
    try {
      return fs.readdirSync(this.checkpointDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.checkpointDir, f), 'utf-8')) as AgentCheckpoint;
          } catch {
            return null;
          }
        })
        .filter((c): c is AgentCheckpoint => c !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  delete(checkpointId: string): boolean {
    const filePath = path.join(this.checkpointDir, `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove all checkpoints older than the given age */
  cleanup(maxAgeMs: number): number {
    const entries = this.list();
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const c of entries) {
      if (c.createdAt < cutoff) {
        if (this.delete(c.id)) removed++;
      }
    }
    return removed;
  }
}
