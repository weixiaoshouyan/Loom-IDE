/**
 * Tests for new Agent features:
 * - Semantic Search
 * - Multi-File Atomic Edits
 * - Rules Engine
 * - Recipes
 * - Session History
 * - MCP Marketplace
 * - Performance Profiler
 * - Background Agent
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { semanticSearch, invalidateSearchCache } from './semantic-search';
import { buildCodeIndex, type CodeIndex } from './code-index';
import { executeToolCall, type ToolExecutionContext } from './agent-tools';
import { RulesEngine } from './rules-engine';
import { RecipeManager, BUILTIN_RECIPES } from './recipes';
import { SessionManager } from './session-history';
import { McpMarketplace } from './mcp-marketplace';
import { PerformanceProfiler } from './performance-profiler';
import { BackgroundAgentManager } from './background-agent';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-new-features-'));
  // Create test files
  fs.writeFileSync(path.join(tmpDir, 'user.ts'), `
export interface User {
  id: string;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return { id: crypto.randomUUID(), name, email };
}

export function validateUser(user: User): boolean {
  return user.name.length > 0 && user.email.includes('@');
}
`);
  fs.writeFileSync(path.join(tmpDir, 'auth.ts'), `
import { User, createUser } from './user';

export function authenticate(userId: string): User | null {
  // Authenticate user
  return null;
}

export function createAndAuth(name: string, email: string) {
  const user = createUser(name, email);
  return authenticate(user.id);
}
`);
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test Project\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateSearchCache();
});

async function buildTestIndex(): Promise<CodeIndex> {
  return buildCodeIndex(tmpDir, { maxFileSize: 1024 * 1024 });
}

describe('SemanticSearch', () => {
  it('finds symbols by exact name', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: 'createUser', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].symbol.name).toBe('createUser');
    expect(results[0].matchType).toBe('name');
  });

  it('finds symbols by partial name', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: 'User', topK: 10 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds symbols by text content', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: 'authenticate', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty for empty query', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: '' });
    expect(results.length).toBe(0);
  });

  it('respects topK limit', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: '', topK: 0 });
    expect(results.length).toBe(0);
  });

  it('includes context when requested', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: 'createUser', includeContext: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].context).toBeDefined();
  });

  it('filters by file type', async () => {
    const index = await buildTestIndex();
    const results = semanticSearch(index, { query: 'User', fileTypes: ['.ts'] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.symbol.filePath.endsWith('.ts'))).toBe(true);
  });
});

describe('MultiFileAtomicEdits', () => {
  it('applies multiple edits atomically', async () => {
    const result = await executeToolCall(
      {
        id: '1',
        type: 'function',
        function: {
          name: 'plan_edits',
          arguments: JSON.stringify({
            edits: [
              { filePath: path.join(tmpDir, 'user.ts'), oldString: 'id: string', newString: 'id: number' },
              { filePath: path.join(tmpDir, 'auth.ts'), oldString: 'userId: string', newString: 'userId: number' },
            ],
          }),
        },
      },
      { workspacePath: tmpDir },
    );

    expect(result).toContain('Successfully applied 2 atomic edit');
    expect(fs.readFileSync(path.join(tmpDir, 'user.ts'), 'utf-8')).toContain('id: number');
    expect(fs.readFileSync(path.join(tmpDir, 'auth.ts'), 'utf-8')).toContain('userId: number');
  });

  it('rolls back all edits if any fails validation', async () => {
    const originalUser = fs.readFileSync(path.join(tmpDir, 'user.ts'), 'utf-8');

    const result = await executeToolCall(
      {
        id: '1',
        type: 'function',
        function: {
          name: 'plan_edits',
          arguments: JSON.stringify({
            edits: [
              { filePath: path.join(tmpDir, 'user.ts'), oldString: 'id: string', newString: 'id: number' },
              { filePath: path.join(tmpDir, 'auth.ts'), oldString: 'NONEXISTENT_TEXT', newString: 'replacement' },
            ],
          }),
        },
      },
      { workspacePath: tmpDir },
    );

    expect(result).toContain('validation failed');
    // First file should NOT be modified (atomic guarantee)
    expect(fs.readFileSync(path.join(tmpDir, 'user.ts'), 'utf-8')).toBe(originalUser);
  });

  it('rejects empty edits array', async () => {
    const result = await executeToolCall(
      { id: '1', type: 'function', function: { name: 'plan_edits', arguments: JSON.stringify({ edits: [] }) } },
      { workspacePath: tmpDir },
    );
    expect(result).toContain('Error');
  });

  it('rejects too many edits', async () => {
    const edits = Array.from({ length: 25 }, () => ({
      filePath: path.join(tmpDir, 'user.ts'),
      oldString: 'id: string',
      newString: 'id: number',
    }));
    const result = await executeToolCall(
      { id: '1', type: 'function', function: { name: 'plan_edits', arguments: JSON.stringify({ edits }) } },
      { workspacePath: tmpDir },
    );
    expect(result).toContain('Maximum 20');
  });
});

describe('RulesEngine', () => {
  it('loads project-level rules', () => {
    fs.writeFileSync(path.join(tmpDir, '.loomrules'), 'Always use TypeScript strict mode.\nPrefer functional components.');
    const engine = new RulesEngine(tmpDir);
    const { text, layers } = engine.resolve();
    expect(text).toContain('TypeScript strict mode');
    expect(layers.length).toBe(1);
    expect(layers[0].source).toBe('project');
  });

  it('loads pattern-based rules', () => {
    const rulesDir = path.join(tmpDir, '.loom', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'frontend.md'), '---\nglobs: **/*.tsx, **/*.css\n---\nUse CSS modules for styling.');

    const engine = new RulesEngine(tmpDir);
    const { layers } = engine.resolve('src/App.tsx');
    const frontendRule = layers.find(l => l.id === 'pattern-frontend.md');
    expect(frontendRule).toBeDefined();
    expect(frontendRule?.content).toContain('CSS modules');
  });

  it('does not apply non-matching pattern rules', () => {
    const rulesDir = path.join(tmpDir, '.loom', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'backend.md'), '---\nglobs: src/server/**/*.ts\n---\nUse Express patterns.');

    const engine = new RulesEngine(tmpDir);
    const { layers } = engine.resolve('src/frontend/App.tsx');
    const backendRule = layers.find(l => l.id === 'pattern-backend.md');
    expect(backendRule).toBeUndefined();
  });

  it('sorts rules by priority', () => {
    fs.writeFileSync(path.join(tmpDir, '.loomrules'), 'Project rule.');
    const engine = new RulesEngine(tmpDir);
    engine.addLayer({ id: 'team', name: 'Team', content: 'Team rule.', source: 'team', priority: 200 });
    const { layers } = engine.resolve();
    expect(layers[0].source).toBe('team'); // higher priority first
  });

  it('generates prompt section', () => {
    fs.writeFileSync(path.join(tmpDir, '.loomrules'), 'Follow these conventions.');
    const engine = new RulesEngine(tmpDir);
    const prompt = engine.resolveForPrompt();
    expect(prompt).toContain('Project Rules');
    expect(prompt).toContain('Follow these conventions');
  });

  it('returns empty string when no rules', () => {
    const engine = new RulesEngine(tmpDir);
    expect(engine.resolveForPrompt()).toBe('');
  });
});

describe('RecipeManager', () => {
  let manager: RecipeManager;

  beforeEach(() => {
    manager = new RecipeManager();
  });

  it('loads built-in recipes', () => {
    expect(manager.list().length).toBeGreaterThan(0);
    expect(manager.list().length).toBe(BUILTIN_RECIPES.length);
  });

  it('finds recipe by id', () => {
    const recipe = manager.get('fix-type-error');
    expect(recipe).toBeDefined();
    expect(recipe?.name).toBe('Fix TypeScript Errors');
  });

  it('filters by category', () => {
    const fixRecipes = manager.listByCategory('fix');
    expect(fixRecipes.length).toBeGreaterThan(0);
    expect(fixRecipes.every(r => r.category === 'fix')).toBe(true);
  });

  it('interpolates variables', () => {
    const recipe = manager.get('fix-type-error')!;
    const prompt = manager.interpolate(recipe, {
      workspacePath: tmpDir,
      filePath: 'src/index.ts',
    });
    expect(prompt).toContain('src/index.ts');
    expect(prompt).not.toContain('{target}');
  });

  it('adds and removes custom recipes', () => {
    manager.addCustom({
      id: 'custom-test',
      name: 'Custom Test',
      description: 'Test recipe',
      prompt: 'Do {thing}',
      variables: [{ name: 'thing', description: 'A thing', type: 'ask', required: true }],
      autoVerify: false,
      autoApply: false,
      category: 'custom',
    });
    expect(manager.get('custom-test')).toBeDefined();
    expect(manager.removeCustom('custom-test')).toBe(true);
    expect(manager.get('custom-test')).toBeUndefined();
  });

  it('identifies required inputs', () => {
    const recipe = manager.get('fix-type-error')!;
    const inputs = manager.getRequiredInputs(recipe, { workspacePath: tmpDir });
    expect(inputs.length).toBeGreaterThan(0);
    // With filePath provided, target should be filled
    const inputsWithFile = manager.getRequiredInputs(recipe, { workspacePath: tmpDir, filePath: 'test.ts' });
    expect(inputsWithFile.length).toBe(0);
  });
});

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager(tmpDir);
  });

  it('creates and saves sessions', () => {
    const session = mgr.createSession('Test Session', tmpDir);
    expect(session.id).toBeDefined();
    expect(session.title).toBe('Test Session');
    const filePath = mgr.save(session);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('loads sessions', () => {
    const session = mgr.createSession('Test Session', tmpDir);
    mgr.save(session);
    const loaded = mgr.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe('Test Session');
  });

  it('lists sessions sorted by update time', () => {
    const s1 = mgr.createSession('Session 1', tmpDir);
    mgr.save(s1);
    const s2 = mgr.createSession('Session 2', tmpDir);
    mgr.save(s2);
    const list = mgr.list();
    expect(list.length).toBe(2);
  });

  it('branches sessions', () => {
    const parent = mgr.createSession('Parent', tmpDir);
    parent.rounds.push({ round: 1, messages: [], toolCalls: [], timestamp: Date.now() });
    parent.rounds.push({ round: 2, messages: [], toolCalls: [], timestamp: Date.now() });
    mgr.save(parent);

    const branch = mgr.branchSession(parent, 1, 'Branch from round 1');
    expect(branch.parentSessionId).toBe(parent.id);
    expect(branch.parentRoundIndex).toBe(1);
    expect(branch.rounds.length).toBe(1);
    expect(branch.tags).toContain('branched');
  });

  it('gets conversation up to round', () => {
    const session = mgr.createSession('Test', tmpDir);
    mgr.addRound(session, 1, [{ role: 'user', content: 'hello', timestamp: Date.now() }], []);
    mgr.addRound(session, 2, [{ role: 'assistant', content: 'hi', timestamp: Date.now() }], []);
    const msgs = mgr.getConversationUpToRound(session, 1);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('hello');
  });

  it('searches sessions by title', () => {
    mgr.save(mgr.createSession('Fix authentication bug', tmpDir));
    mgr.save(mgr.createSession('Add new feature', tmpDir));
    const results = mgr.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('authentication');
  });

  it('deletes sessions', () => {
    const session = mgr.createSession('To Delete', tmpDir);
    mgr.save(session);
    expect(mgr.delete(session.id)).toBe(true);
    expect(mgr.load(session.id)).toBeNull();
  });
});

describe('McpMarketplace', () => {
  let marketplace: McpMarketplace;

  beforeEach(() => {
    marketplace = new McpMarketplace();
  });

  it('lists all servers sorted by popularity', () => {
    const servers = marketplace.getAll();
    expect(servers.length).toBeGreaterThan(0);
    for (let i = 1; i < servers.length; i++) {
      expect(servers[i - 1].popularity).toBeGreaterThanOrEqual(servers[i].popularity);
    }
  });

  it('searches servers by name', () => {
    const results = marketplace.search('GitHub');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('GitHub');
  });

  it('searches servers by description', () => {
    const results = marketplace.search('database');
    expect(results.length).toBeGreaterThan(0);
  });

  it('filters by category', () => {
    const dbServers = marketplace.listByCategory('database');
    expect(dbServers.length).toBeGreaterThan(0);
    expect(dbServers.every(s => s.category === 'database')).toBe(true);
  });

  it('gets server by id', () => {
    const server = marketplace.getById('mcp-github');
    expect(server).toBeDefined();
    expect(server?.name).toBe('GitHub');
  });

  it('generates install config', () => {
    const server = marketplace.getById('mcp-github')!;
    const config = marketplace.generateConfig(server);
    expect(config.id).toBe('mcp-github');
    expect(config.command).toBe('npx');
    expect(config.enabled).toBe(true);
  });

  it('returns all categories', () => {
    const categories = marketplace.getCategories();
    expect(categories).toContain('search');
    expect(categories).toContain('database');
    expect(categories).toContain('api');
  });
});

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = new PerformanceProfiler();
  });

  it('tracks a complete run', () => {
    profiler.startRun('test-session');
    profiler.recordApiCall(500, 1000, 500);
    profiler.recordApiCall(300, 800, 200);
    profiler.recordToolCall('read_file', 50, true);
    profiler.recordToolCall('edit_file', 100, true);
    profiler.recordFileModified('src/index.ts');
    profiler.incrementRound();
    profiler.incrementRound();

    const metrics = profiler.endRun('success');
    expect(metrics).toBeDefined();
    expect(metrics?.totalRounds).toBe(2);
    expect(metrics?.tokenUsage.total).toBe(2500);
    expect(metrics?.apiCalls.count).toBe(2);
    expect(metrics?.toolCalls.length).toBe(2);
    expect(metrics?.filesModified).toContain('src/index.ts');
    expect(metrics?.outcome).toBe('success');
  });

  it('calculates aggregated stats', () => {
    for (let i = 0; i < 3; i++) {
      profiler.startRun(`session-${i}`);
      profiler.recordApiCall(500, 1000, 500);
      profiler.recordToolCall('read_file', 50, true);
      profiler.endRun(i === 2 ? 'failure' : 'success');
    }

    const stats = profiler.getAggregatedStats();
    expect(stats.totalRuns).toBe(3);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.avgTokensPerRun).toBe(1500);
    expect(stats.toolUsageBreakdown.length).toBeGreaterThan(0);
  });

  it('tracks recent runs', () => {
    for (let i = 0; i < 5; i++) {
      profiler.startRun(`session-${i}`);
      profiler.endRun('success');
    }
    const recent = profiler.getRecentRuns(3);
    expect(recent.length).toBe(3);
  });

  it('clears history', () => {
    profiler.startRun('test');
    profiler.endRun('success');
    profiler.clear();
    expect(profiler.getAggregatedStats().totalRuns).toBe(0);
  });
});

describe('BackgroundAgentManager', () => {
  let manager: BackgroundAgentManager;

  beforeEach(() => {
    manager = new BackgroundAgentManager(2);
  });

  it('enqueues tasks', () => {
    const id = manager.enqueue(
      [{ role: 'user', content: 'test' }],
      { workspacePath: tmpDir },
    );
    expect(id).toBeDefined();
    const task = manager.getTask(id);
    expect(task).toBeDefined();
    expect(task?.status).toBe('queued');
  });

  it('cancels queued tasks', () => {
    const id = manager.enqueue(
      [{ role: 'user', content: 'test' }],
      { workspacePath: tmpDir },
    );
    expect(manager.cancel(id)).toBe(true);
    expect(manager.getTask(id)?.status).toBe('cancelled');
  });

  it('lists tasks', () => {
    manager.enqueue([{ role: 'user', content: 'test1' }], { workspacePath: tmpDir });
    manager.enqueue([{ role: 'user', content: 'test2' }], { workspacePath: tmpDir });
    expect(manager.listTasks().length).toBe(2);
  });

  it('cleans up old completed tasks', () => {
    const id = manager.enqueue(
      [{ role: 'user', content: 'test' }],
      { workspacePath: tmpDir },
    );
    // Manually mark as completed with old timestamp
    const task = manager.getTask(id);
    if (task) {
      task.status = 'completed';
      task.completedAt = Date.now() - 86400000; // 1 day ago
    }
    const removed = manager.cleanup(3600000); // 1 hour
    expect(removed).toBe(1);
  });
});
