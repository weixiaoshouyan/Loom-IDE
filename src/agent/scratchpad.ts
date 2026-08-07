/**
 * Loom Agent Scratchpad (Working Memory)
 *
 * Provides a persistent key-value store that the Agent can use to
 * record intermediate conclusions, todos, decisions, and facts
 * across tool-call rounds. Unlike the conversation context (which
 * grows and gets truncated), the scratchpad is a compact, structured
 * memory that persists for the lifetime of one Agent run.
 */

export interface ScratchpadEntry {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  /** How many times this entry has been read (for LRU eviction) */
  accessCount: number;
}

export class Scratchpad {
  private entries: Map<string, ScratchpadEntry> = new Map();
  private _maxSize: number;

  constructor(maxSize = 50) {
    this._maxSize = maxSize;
  }

  set(key: string, value: string): void {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = now;
    } else {
      if (this.entries.size >= this._maxSize) {
        this.evictLRU();
      }
      this.entries.set(key, { key, value, createdAt: now, updatedAt: now, accessCount: 0 });
    }
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      entry.accessCount++;
      return entry.value;
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Return a compact summary for injection into the system prompt */
  summarize(): string {
    if (this.entries.size === 0) return '';
    const lines: string[] = ['\n## Agent Working Memory'];
    for (const entry of this.entries.values()) {
      lines.push(`- ${entry.key}: ${entry.value.slice(0, 200)}`);
    }
    return lines.join('\n');
  }

  /** Return all entries as a plain object (for checkpoint serialization) */
  toJSON(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.entries) {
      obj[k] = v.value;
    }
    return obj;
  }

  /** Restore from a plain object */
  static fromJSON(obj: Record<string, string>): Scratchpad {
    const sp = new Scratchpad();
    for (const [k, v] of Object.entries(obj)) {
      sp.set(k, v);
    }
    return sp;
  }

  private evictLRU(): void {
    let oldest: { key: string; score: number } | null = null;
    for (const entry of this.entries.values()) {
      // Score: lower access + older = more evictable
      const score = entry.accessCount * 1000 + (Date.now() - entry.updatedAt);
      if (!oldest || score < oldest.score) {
        oldest = { key: entry.key, score };
      }
    }
    if (oldest) this.entries.delete(oldest.key);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
