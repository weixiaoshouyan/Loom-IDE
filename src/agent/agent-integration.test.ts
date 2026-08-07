/**
 * Agent Integration Tests
 *
 * End-to-end tests for the Agent system: state machine transitions,
 * scratchpad operations, token budget enforcement, tool execution,
 * and checkpoint save/load.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { AgentStateMachine, DEFAULT_STATE_MACHINE_CONFIG } from './agent-state-machine';
import { Scratchpad } from './scratchpad';
import { TokenBudgetManager, DEFAULT_TOKEN_BUDGET_CONFIG } from './token-budget';
import { CheckpointManager } from './checkpoint';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentStateMachine', () => {
  it('transitions through expected states', () => {
    const sm = new AgentStateMachine();
    expect(sm.state).toBe('PLANNING');
    sm.transition('TOOL_EXECUTION');
    expect(sm.state).toBe('TOOL_EXECUTION');
    sm.transition('DONE');
    expect(sm.isTerminal).toBe(true);
  });

  it('tracks rounds correctly', () => {
    const sm = new AgentStateMachine();
    expect(sm.round).toBe(0);
    sm.nextRound();
    sm.nextRound();
    expect(sm.round).toBe(2);
  });

  it('shouldReflect triggers at configured interval', () => {
    const sm = new AgentStateMachine({
      ...DEFAULT_STATE_MACHINE_CONFIG,
      reflectionInterval: 2,
    });
    sm.nextRound();
    sm.transition('TOOL_EXECUTION');
    expect(sm.shouldReflect()).toBe(false);
    sm.nextRound();
    expect(sm.shouldReflect()).toBe(true);
  });

  it('respects abort signal', () => {
    const controller = new AbortController();
    const sm = new AgentStateMachine(DEFAULT_STATE_MACHINE_CONFIG, controller.signal);
    expect(sm.isAborted).toBe(false);
    controller.abort();
    expect(sm.isAborted).toBe(true);
    expect(sm.computeNextState(true)).toBe('ERROR');
  });

  it('detects timeout', async () => {
    const sm = new AgentStateMachine({
      ...DEFAULT_STATE_MACHINE_CONFIG,
      stateTimeoutMs: 10,
    });
    sm.transition('TOOL_EXECUTION');
    await new Promise(r => setTimeout(r, 20));
    expect(sm.isTimedOut()).toBe(true);
  });

  it('computes next state based on conditions', () => {
    const sm = new AgentStateMachine();
    expect(sm.computeNextState(true)).toBe('TOOL_EXECUTION');
    sm.transition('TOOL_EXECUTION');
    expect(sm.computeNextState(false, true)).toBe('VERIFICATION');
  });

  it('produces valid snapshot', () => {
    const sm = new AgentStateMachine();
    sm.nextRound();
    sm.setMetadata('testKey', 'testValue');
    const snapshot = sm.snapshot();
    expect(snapshot.state).toBe('PLANNING');
    expect(snapshot.round).toBe(1);
    expect(snapshot.totalRounds).toBe(DEFAULT_STATE_MACHINE_CONFIG.maxRounds);
    expect(snapshot.metadata?.testKey).toBe('testValue');
  });
});

describe('Scratchpad', () => {
  let scratchpad: Scratchpad;

  beforeEach(() => {
    scratchpad = new Scratchpad();
  });

  it('stores and retrieves values', () => {
    scratchpad.set('key1', 'value1');
    expect(scratchpad.get('key1')).toBe('value1');
  });

  it('updates existing values', () => {
    scratchpad.set('key1', 'value1');
    scratchpad.set('key1', 'value2');
    expect(scratchpad.get('key1')).toBe('value2');
  });

  it('checks existence', () => {
    scratchpad.set('key1', 'value1');
    expect(scratchpad.has('key1')).toBe(true);
    expect(scratchpad.has('key2')).toBe(false);
  });

  it('deletes entries', () => {
    scratchpad.set('key1', 'value1');
    expect(scratchpad.delete('key1')).toBe(true);
    expect(scratchpad.has('key1')).toBe(false);
  });

  it('returns undefined for missing keys', () => {
    expect(scratchpad.get('nonexistent')).toBeUndefined();
  });

  it('summarizes entries for prompt injection', () => {
    scratchpad.set('todo', 'Fix bug #123');
    scratchpad.set('decision', 'Use approach A');
    const summary = scratchpad.summarize();
    expect(summary).toContain('todo');
    expect(summary).toContain('Fix bug #123');
    expect(summary).toContain('decision');
  });

  it('returns empty summary when empty', () => {
    expect(scratchpad.summarize()).toBe('');
  });

  it('enforces max size with LRU eviction', () => {
    const sp = new Scratchpad(3);
    sp.set('a', '1');
    sp.set('b', '2');
    sp.set('c', '3');
    sp.get('a'); // access 'a' to boost its score
    sp.set('d', '4'); // should evict 'b' or 'c' (least recently used)
    expect(sp.size).toBe(3);
    expect(sp.has('a')).toBe(true); // 'a' was accessed, should survive
  });

  it('serializes and deserializes via JSON', () => {
    scratchpad.set('key1', 'value1');
    scratchpad.set('key2', 'value2');
    const json = scratchpad.toJSON();
    const restored = Scratchpad.fromJSON(json);
    expect(restored.get('key1')).toBe('value1');
    expect(restored.get('key2')).toBe('value2');
  });

  it('clears all entries', () => {
    scratchpad.set('key1', 'value1');
    scratchpad.set('key2', 'value2');
    scratchpad.clear();
    expect(scratchpad.size).toBe(0);
  });
});

describe('TokenBudgetManager', () => {
  let budget: TokenBudgetManager;

  beforeEach(() => {
    budget = new TokenBudgetManager();
  });

  it('starts with zero usage', () => {
    expect(budget.usedTokens).toBe(0);
    expect(budget.usageRatio).toBe(0);
  });

  it('records usage correctly', () => {
    budget.recordUsage(1000, 500);
    expect(budget.usedTokens).toBe(1500);
    expect(budget.remainingTokens).toBe(DEFAULT_TOKEN_BUDGET_CONFIG.maxTokens - 1500);
  });

  it('triggers compression at threshold', () => {
    const budget2 = new TokenBudgetManager({
      ...DEFAULT_TOKEN_BUDGET_CONFIG,
      maxTokens: 10000,
    });
    const event = budget2.recordUsage(7000, 0); // 70% > 60% threshold
    expect(event.type).toBe('compression');
    expect(budget2.isCompressed).toBe(true);
  });

  it('triggers termination at threshold', () => {
    const budget2 = new TokenBudgetManager({
      ...DEFAULT_TOKEN_BUDGET_CONFIG,
      maxTokens: 10000,
    });
    const event = budget2.recordUsage(9500, 0); // 95% > 90% threshold
    expect(event.type).toBe('termination');
  });

  it('does not double-trigger compression', () => {
    const budget2 = new TokenBudgetManager({
      ...DEFAULT_TOKEN_BUDGET_CONFIG,
      maxTokens: 10000,
    });
    budget2.recordUsage(7000, 0);
    const event = budget2.recordUsage(1000, 0);
    expect(event.type).toBe('ok'); // already compressed
  });

  it('canAfford predicts budget availability', () => {
    budget.recordUsage(5000, 0);
    expect(budget.canAfford(1000)).toBe(true);
    expect(budget.canAfford(DEFAULT_TOKEN_BUDGET_CONFIG.maxTokens)).toBe(false);
  });

  it('reset clears all state', () => {
    budget.recordUsage(1000, 500);
    budget.reset();
    expect(budget.usedTokens).toBe(0);
    expect(budget.isCompressed).toBe(false);
  });
});

describe('CheckpointManager', () => {
  let tmpDir: string;
  let mgr: CheckpointManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-'));
    mgr = new CheckpointManager(tmpDir);
  });

  it('saves and loads checkpoints', () => {
    const checkpoint = {
      id: 'test-ckpt-1',
      version: 1 as const,
      createdAt: Date.now(),
      workspacePath: tmpDir,
      messages: [{ role: 'user' as const, content: 'test' }],
      scratchpad: { todo: 'fix bug' },
      state: {
        state: 'TOOL_EXECUTION' as const,
        round: 2,
        totalRounds: 10,
        startedAt: Date.now(),
        lastTransitionAt: Date.now(),
      },
    };

    const filePath = mgr.save(checkpoint);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = mgr.load('test-ckpt-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('test-ckpt-1');
    expect(loaded?.messages[0].content).toBe('test');
    expect(loaded?.scratchpad.todo).toBe('fix bug');
  });

  it('returns null for nonexistent checkpoint', () => {
    expect(mgr.load('nonexistent')).toBeNull();
  });

  it('lists checkpoints sorted by creation time', () => {
    const ckpt1 = { id: 'ckpt-1', version: 1 as const, createdAt: 1000, workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    const ckpt2 = { id: 'ckpt-2', version: 1 as const, createdAt: 3000, workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    const ckpt3 = { id: 'ckpt-3', version: 1 as const, createdAt: 2000, workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };

    mgr.save(ckpt1);
    mgr.save(ckpt2);
    mgr.save(ckpt3);

    const list = mgr.list();
    expect(list.length).toBe(3);
    expect(list[0].id).toBe('ckpt-2'); // newest first
    expect(list[1].id).toBe('ckpt-3');
    expect(list[2].id).toBe('ckpt-1');
  });

  it('loads the most recent checkpoint', () => {
    const ckpt1 = { id: 'old', version: 1 as const, createdAt: 1000, workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    const ckpt2 = { id: 'new', version: 1 as const, createdAt: 2000, workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    mgr.save(ckpt1);
    mgr.save(ckpt2);

    const latest = mgr.loadLatest();
    expect(latest?.id).toBe('new');
  });

  it('deletes checkpoints', () => {
    const ckpt = { id: 'to-delete', version: 1 as const, createdAt: Date.now(), workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    mgr.save(ckpt);
    expect(mgr.delete('to-delete')).toBe(true);
    expect(mgr.load('to-delete')).toBeNull();
    expect(mgr.delete('to-delete')).toBe(false); // already deleted
  });

  it('cleanup removes old checkpoints', () => {
    const old = { id: 'old', version: 1 as const, createdAt: Date.now() - 86400000, workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    const recent = { id: 'recent', version: 1 as const, createdAt: Date.now(), workspacePath: tmpDir, messages: [], scratchpad: {}, state: { state: 'DONE' as const, round: 0, totalRounds: 10, startedAt: 0, lastTransitionAt: 0 } };
    mgr.save(old);
    mgr.save(recent);

    const removed = mgr.cleanup(3600000); // 1 hour
    expect(removed).toBe(1);
    expect(mgr.load('old')).toBeNull();
    expect(mgr.load('recent')).not.toBeNull();
  });
});

describe('Agent tool error recovery', () => {
  it('executeEditFile returns enhanced error with file snippet', async () => {
    const { executeToolCall, AGENT_TOOLS } = await import('./agent-tools');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-edit-test-'));
    const testFile = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(testFile, 'const a = 1;\nconst b = 2;\nconst c = 3;');

    const result = await executeToolCall(
      { id: '1', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ filePath: testFile, oldString: 'nonexistent', newString: 'replacement' }) } },
      { workspacePath: tmpDir },
    );

    expect(result).toContain('Error');
    expect(result).toContain('Could not find the exact text');
    expect(result).toContain('File starts with');
  });

  it('executeEditFile returns suggestion for wrong filename', async () => {
    const { executeToolCall } = await import('./agent-tools');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-edit-test-'));
    fs.writeFileSync(path.join(tmpDir, 'component.tsx'), 'export default function() {}');

    const result = await executeToolCall(
      { id: '1', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ filePath: path.join(tmpDir, 'component.ts'), oldString: 'x', newString: 'y' }) } },
      { workspacePath: tmpDir },
    );

    expect(result).toContain('Error');
    expect(result).toContain('Did you mean');
  });
});
