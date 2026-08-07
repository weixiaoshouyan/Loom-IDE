import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CloudSyncManager, type TeamRules } from './cloud-sync';

const createdDirs: string[] = [];

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-rules-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CloudSyncManager.loadTeamRules', () => {
  it('returns an empty object when no rules file exists', () => {
    const workspace = makeWorkspace();
    const mgr = new CloudSyncManager();
    expect(mgr.loadTeamRules(workspace)).toEqual({});
  });

  it('parses a plain-text rules file as instructions', () => {
    const workspace = makeWorkspace();
    fs.mkdirSync(path.join(workspace, '.loom'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.loom', 'rules'), 'Always use tabs.', 'utf-8');

    const mgr = new CloudSyncManager();
    const rules = mgr.loadTeamRules(workspace);
    expect(rules.instructions).toBe('Always use tabs.');
  });

  it('parses a JSON rules file with fileRules', () => {
    const workspace = makeWorkspace();
    fs.mkdirSync(path.join(workspace, '.loom'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.loom', 'rules'), JSON.stringify({
      instructions: 'General rule.',
      fileRules: [
        { pattern: 'src/**/*.ts', instructions: 'Use TypeScript strict mode.' },
        { pattern: 'tests/**', instructions: 'Prefer vitest.' },
        { pattern: 'docs/*.md', instructions: 'Keep docs concise.' },
      ],
    }), 'utf-8');

    const mgr = new CloudSyncManager();
    const rules = mgr.loadTeamRules(workspace);
    expect(rules.instructions).toBe('General rule.');
    expect(rules.fileRules).toHaveLength(3);
    expect(rules.fileRules![0].pattern).toBe('src/**/*.ts');
  });

  it('ignores malformed fileRules entries', () => {
    const workspace = makeWorkspace();
    fs.mkdirSync(path.join(workspace, '.loom'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.loom', 'rules'), JSON.stringify({
      fileRules: [
        { pattern: 'src/**', instructions: 'OK' },
        { noPattern: 'bad' },
        null,
      ],
    }), 'utf-8');

    const mgr = new CloudSyncManager();
    const rules = mgr.loadTeamRules(workspace);
    expect(rules.fileRules).toHaveLength(1);
    expect(rules.fileRules![0].pattern).toBe('src/**');
  });
});

describe('CloudSyncManager.formatRulesPrompt', () => {
  it('returns empty string for empty rules', () => {
    const mgr = new CloudSyncManager();
    expect(mgr.formatRulesPrompt({})).toBe('');
  });

  it('formats instructions, include, exclude, conventions', () => {
    const mgr = new CloudSyncManager();
    const prompt = mgr.formatRulesPrompt({
      instructions: 'Be terse.',
      include: ['src/**'],
      exclude: ['dist/**'],
      conventions: { indent: '2 spaces' },
    });
    expect(prompt).toContain('Team instructions:');
    expect(prompt).toContain('Be terse.');
    expect(prompt).toContain('Always include these paths: src/**');
    expect(prompt).toContain('Always exclude these paths: dist/**');
    expect(prompt).toContain('indent: 2 spaces');
  });

  it('formats file-specific rules', () => {
    const mgr = new CloudSyncManager();
    const prompt = mgr.formatRulesPrompt({
      fileRules: [
        { pattern: '**/*.ts', instructions: 'Use strict mode.' },
        { pattern: '**/*.test.ts', instructions: 'Use describe/it.' },
      ],
    });
    expect(prompt).toContain('File-specific rules:');
    expect(prompt).toContain('**/*.ts: Use strict mode.');
    expect(prompt).toContain('**/*.test.ts: Use describe/it.');
  });

  it('omits excluded file rules from the prompt', () => {
    const mgr = new CloudSyncManager();
    const prompt = mgr.formatRulesPrompt({
      fileRules: [
        { pattern: '**/*.ts', instructions: 'Use strict mode.', include: false },
      ],
    });
    expect(prompt).not.toContain('Use strict mode.');
  });
});

describe('CloudSyncManager.getRulesForFile', () => {
  const rules: TeamRules = {
    instructions: 'General.',
    fileRules: [
      { pattern: 'src/**/*.ts', instructions: 'TS strict.' },
      { pattern: 'tests/**', instructions: 'Vitest.' },
      { pattern: 'docs/*.md', instructions: 'Concise docs.' },
      { pattern: 'secret/**', instructions: 'Hidden.', include: false },
    ],
  };

  it('returns matching instructions for a deep source file', () => {
    const mgr = new CloudSyncManager();
    const result = mgr.getRulesForFile(rules, 'src/app/main.ts');
    expect(result).toContain('TS strict.');
    expect(result).not.toContain('Vitest.');
  });

  it('returns matching instructions for a test file', () => {
    const mgr = new CloudSyncManager();
    const result = mgr.getRulesForFile(rules, 'tests/unit/foo.test.ts');
    expect(result).toContain('Vitest.');
  });

  it('returns empty string when no pattern matches', () => {
    const mgr = new CloudSyncManager();
    const result = mgr.getRulesForFile(rules, 'README.md');
    expect(result).toBe('');
  });

  it('skips rules marked include=false', () => {
    const mgr = new CloudSyncManager();
    const result = mgr.getRulesForFile(rules, 'secret/config.json');
    expect(result).toBe('');
  });

  it('handles Windows-style backslash paths', () => {
    const mgr = new CloudSyncManager();
    const result = mgr.getRulesForFile(rules, 'src\\app\\main.ts');
    expect(result).toContain('TS strict.');
  });

  it('returns empty string when fileRules is undefined', () => {
    const mgr = new CloudSyncManager();
    const result = mgr.getRulesForFile({ instructions: 'General.' }, 'src/foo.ts');
    expect(result).toBe('');
  });
});
