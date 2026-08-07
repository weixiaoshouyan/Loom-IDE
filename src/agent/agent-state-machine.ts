/**
 * Loom Agent State Machine
 *
 * Explicit state machine for the Agent lifecycle:
 *   PLANNING → TOOL_EXECUTION → REFLECTION → VERIFICATION → DONE
 *
 * Each state has independent error handling, timeout policy, and
 * transition rules. Replaces the implicit state previously encoded
 * in the conversation array.
 */

export type AgentState =
  | 'PLANNING'
  | 'TOOL_EXECUTION'
  | 'REFLECTION'
  | 'VERIFICATION'
  | 'DONE'
  | 'ERROR';

export interface AgentStateSnapshot {
  state: AgentState;
  round: number;
  totalRounds: number;
  startedAt: number;
  lastTransitionAt: number;
  metadata?: Record<string, unknown>;
}

export interface AgentStateMachineConfig {
  maxRounds: number;
  reflectionInterval: number;
  enableVerification: boolean;
  stateTimeoutMs: number;
}

export const DEFAULT_STATE_MACHINE_CONFIG: AgentStateMachineConfig = {
  maxRounds: 10,
  reflectionInterval: 3,
  enableVerification: true,
  stateTimeoutMs: 120000,
};

export class AgentStateMachine {
  private _state: AgentState = 'PLANNING';
  private _round = 0;
  private _startedAt = Date.now();
  private _lastTransitionAt = Date.now();
  private _metadata: Record<string, unknown> = {};

  constructor(
    private config: AgentStateMachineConfig = DEFAULT_STATE_MACHINE_CONFIG,
    private abortSignal?: AbortSignal,
  ) {}

  get state(): AgentState { return this._state; }
  get round(): number { return this._round; }
  get isTerminal(): boolean {
    return this._state === 'DONE' || this._state === 'ERROR';
  }
  get isAborted(): boolean {
    return this.abortSignal?.aborted === true;
  }

  transition(to: AgentState, metadata?: Record<string, unknown>): void {
    this._state = to;
    this._lastTransitionAt = Date.now();
    if (metadata) this._metadata = { ...this._metadata, ...metadata };
  }

  nextRound(): void {
    this._round++;
    this._lastTransitionAt = Date.now();
  }

  setMetadata(key: string, value: unknown): void {
    this._metadata[key] = value;
  }

  getMetadata(key: string): unknown {
    return this._metadata[key];
  }

  /** Whether the current state has exceeded its timeout */
  isTimedOut(): boolean {
    return Date.now() - this._lastTransitionAt > this.config.stateTimeoutMs;
  }

  /** Whether it is time for a reflection round */
  shouldReflect(): boolean {
    return this._round > 0
      && this._round % this.config.reflectionInterval === 0
      && this._state === 'TOOL_EXECUTION';
  }

  /** Compute the next state based on current conditions */
  computeNextState(hasToolCalls: boolean, verificationPassed?: boolean): AgentState {
    if (this.isAborted) return 'ERROR';

    switch (this._state) {
      case 'PLANNING':
        return 'TOOL_EXECUTION';
      case 'TOOL_EXECUTION':
        if (this._round >= this.config.maxRounds) {
          return this.config.enableVerification ? 'VERIFICATION' : 'DONE';
        }
        if (this.shouldReflect()) return 'REFLECTION';
        if (!hasToolCalls) {
          return this.config.enableVerification ? 'VERIFICATION' : 'DONE';
        }
        return 'TOOL_EXECUTION';
      case 'REFLECTION':
        return 'TOOL_EXECUTION';
      case 'VERIFICATION':
        return verificationPassed ? 'DONE' : 'TOOL_EXECUTION';
      default:
        return 'DONE';
    }
  }

  snapshot(): AgentStateSnapshot {
    return {
      state: this._state,
      round: this._round,
      totalRounds: this.config.maxRounds,
      startedAt: this._startedAt,
      lastTransitionAt: this._lastTransitionAt,
      metadata: { ...this._metadata },
    };
  }
}
