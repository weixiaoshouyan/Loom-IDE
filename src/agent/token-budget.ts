/**
 * Loom Agent Token Budget Manager
 *
 * Tracks token consumption against a configurable budget during an
 * Agent run. When the budget is approaching, it can trigger:
 * - Conversation compression (summarize early messages)
 * - Early termination with a summary
 * - UI progress indication
 */

export interface TokenBudgetConfig {
  maxTokens: number;
  /** Fraction of budget at which to trigger compression (0-1) */
  compressionThreshold: number;
  /** Fraction of budget at which to trigger early termination (0-1) */
  terminationThreshold: number;
}

export const DEFAULT_TOKEN_BUDGET_CONFIG: TokenBudgetConfig = {
  maxTokens: 80000,
  compressionThreshold: 0.6,
  terminationThreshold: 0.9,
};

export type TokenBudgetEvent =
  | { type: 'ok'; used: number; remaining: number }
  | { type: 'compression'; used: number; remaining: number }
  | { type: 'termination'; used: number; remaining: number };

export class TokenBudgetManager {
  private _usedTokens = 0;
  private _compressed = false;

  constructor(private config: TokenBudgetConfig = DEFAULT_TOKEN_BUDGET_CONFIG) {}

  get usedTokens(): number { return this._usedTokens; }
  get remainingTokens(): number {
    return Math.max(0, this.config.maxTokens - this._usedTokens);
  }
  get usageRatio(): number {
    return this._usedTokens / this.config.maxTokens;
  }
  get isCompressed(): boolean { return this._compressed; }

  /** Record token usage for one API call */
  recordUsage(inputTokens: number, outputTokens: number): TokenBudgetEvent {
    this._usedTokens += inputTokens + outputTokens;

    if (this.usageRatio >= this.config.terminationThreshold) {
      return { type: 'termination', used: this._usedTokens, remaining: this.remainingTokens };
    }
    if (this.usageRatio >= this.config.compressionThreshold && !this._compressed) {
      this._compressed = true;
      return { type: 'compression', used: this._usedTokens, remaining: this.remainingTokens };
    }
    return { type: 'ok', used: this._usedTokens, remaining: this.remainingTokens };
  }

  /** Check if a proposed call would exceed budget */
  canAfford(estimatedTokens: number): boolean {
    return (this._usedTokens + estimatedTokens) < this.config.maxTokens;
  }

  /** Mark compression as done, reset the compressed flag for next window */
  markCompressed(): void {
    this._compressed = false;
  }

  reset(): void {
    this._usedTokens = 0;
    this._compressed = false;
  }
}
