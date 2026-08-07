import { describe, it, expect } from 'vitest';
import { SkillManager } from './skills';

describe('SkillManager.resolvePrompt', () => {
  function managerWith(prompt: string): SkillManager {
    const mgr = new SkillManager();
    mgr.addSkill({
      id: 'test-skill',
      name: 'Test Skill',
      description: 'for tests',
      category: 'custom',
      prompt,
      icon: '',
    } as any);
    return mgr;
  }

  it('replaces all occurrences of the same variable', () => {
    const mgr = managerWith('Target: {target}. Please refactor {target} carefully. {target} again.');
    const resolved = mgr.resolvePrompt('test-skill', { target: 'foo.ts' });
    expect(resolved).toBe('Target: foo.ts. Please refactor foo.ts carefully. foo.ts again.');
    expect(resolved).not.toContain('{target}');
  });

  it('replaces multiple different variables globally', () => {
    const mgr = managerWith('{language} code:\n{code}\n\nRewrite the {language} code above.');
    const resolved = mgr.resolvePrompt('test-skill', { language: 'TypeScript', code: 'const a = 1;' });
    expect(resolved).toBe('TypeScript code:\nconst a = 1;\n\nRewrite the TypeScript code above.');
  });

  it('keeps unresolved placeholders when the variable value is empty', () => {
    const mgr = managerWith('Fix {code} in {target}');
    const resolved = mgr.resolvePrompt('test-skill', { target: '' });
    expect(resolved).toBe('Fix {code} in {target}');
  });

  it('falls back to selectedText for {code} occurrences', () => {
    const mgr = managerWith('Review:\n{code}\nEnd of {code}');
    const resolved = mgr.resolvePrompt('test-skill', { selectedText: 'let x = 2;' });
    expect(resolved).toBe('Review:\nlet x = 2;\nEnd of let x = 2;');
  });

  it('returns null for an unknown skill id', () => {
    const mgr = new SkillManager();
    expect(mgr.resolvePrompt('nope', {})).toBeNull();
  });
});
