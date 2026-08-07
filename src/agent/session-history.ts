/**
 * Loom Session History & Branching
 *
 * Records complete Agent sessions and supports branching from
 * any round to try alternative approaches. Similar to git's
 * branch model applied to AI conversations.
 */

import fs from 'fs';
import path from 'path';
import type { ChatMessage } from './ai-engine';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  round?: number;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface SessionRound {
  round: number;
  messages: SessionMessage[];
  toolCalls: string[];
  timestamp: number;
}

export interface AgentSession {
  id: string;
  version: 1;
  title: string;
  workspacePath: string;
  rounds: SessionRound[];
  /** Parent session ID if this was branched from another */
  parentSessionId?: string;
  /** Parent round index if branched */
  parentRoundIndex?: number;
  createdAt: number;
  updatedAt: number;
  /** Tags for organization */
  tags: string[];
  /** Whether this session led to a successful outcome */
  outcome?: 'success' | 'failure' | 'abandoned';
}

export class SessionManager {
  private sessionsDir: string;

  constructor(workspacePath: string) {
    this.sessionsDir = path.join(workspacePath, '.loom', 'sessions');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Create a new session.
   */
  createSession(title: string, workspacePath: string, parentSessionId?: string, parentRoundIndex?: number): AgentSession {
    const session: AgentSession = {
      id: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      version: 1,
      title,
      workspacePath,
      rounds: [],
      parentSessionId,
      parentRoundIndex,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
    };
    return session;
  }

  /**
   * Add a round to a session.
   */
  addRound(session: AgentSession, round: number, messages: SessionMessage[], toolCalls: string[]): void {
    session.rounds.push({ round, messages, toolCalls, timestamp: Date.now() });
    session.updatedAt = Date.now();
  }

  /**
   * Create a branch from a specific round of another session.
   */
  branchSession(parentSession: AgentSession, branchFromRound: number, newTitle: string): AgentSession {
    // Copy rounds up to and including the branch point
    const copiedRounds = parentSession.rounds.filter(r => r.round <= branchFromRound);

    return {
      id: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      version: 1,
      title: newTitle,
      workspacePath: parentSession.workspacePath,
      rounds: JSON.parse(JSON.stringify(copiedRounds)), // deep copy
      parentSessionId: parentSession.id,
      parentRoundIndex: branchFromRound,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [...parentSession.tags, 'branched'],
    };
  }

  /**
   * Get a snapshot of the conversation up to a given round.
   * Useful for restoring the model's context when branching.
   */
  getConversationUpToRound(session: AgentSession, round: number): SessionMessage[] {
    const messages: SessionMessage[] = [];
    for (const r of session.rounds) {
      if (r.round <= round) {
        messages.push(...r.messages);
      }
    }
    return messages;
  }

  save(session: AgentSession): string {
    this.ensureDir();
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    return filePath;
  }

  load(sessionId: string): AgentSession | null {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentSession;
    } catch {
      return null;
    }
  }

  /**
   * List sessions sorted by update time (newest first).
   */
  list(): AgentSession[] {
    if (!fs.existsSync(this.sessionsDir)) return [];
    try {
      return fs.readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8')) as AgentSession;
          } catch {
            return null;
          }
        })
        .filter((s): s is AgentSession => s !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /**
   * Delete a session.
   */
  delete(sessionId: string): boolean {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search sessions by title or tags.
   */
  search(query: string): AgentSession[] {
    const q = query.toLowerCase();
    return this.list().filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)),
    );
  }

  /**
   * Get session tree (parent-child relationships).
   */
  getSessionTree(): Array<{ session: AgentSession; children: AgentSession[] }> {
    const all = this.list();
    const roots = all.filter(s => !s.parentSessionId);
    return roots.map(root => ({
      session: root,
      children: all.filter(s => s.parentSessionId === root.id),
    }));
  }

  /**
   * Clean up sessions older than the given age.
   */
  cleanup(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const sessions = this.list();
    let removed = 0;
    for (const s of sessions) {
      if (s.updatedAt < cutoff && s.outcome !== 'success') {
        if (this.delete(s.id)) removed++;
      }
    }
    return removed;
  }
}
