import { describe, expect, it } from 'vitest';
import { hasUnsafeGitArg } from './git-handlers';

describe('hasUnsafeGitArg', () => {
  it('allows benign git args', () => {
    expect(hasUnsafeGitArg(['status', '-sb', '--untracked-files=all'])).toBe(false);
    expect(hasUnsafeGitArg(['add', '--', 'src/foo.ts'])).toBe(false);
    expect(hasUnsafeGitArg(['log', '--oneline', '-10'])).toBe(false);
    expect(hasUnsafeGitArg(['commit', '-m', 'message'])).toBe(false);
  });

  it('blocks -c / -C and work-tree / git-dir escapes', () => {
    expect(hasUnsafeGitArg(['-c', 'core.hooksPath=/tmp/x', 'commit'])).toBe(true);
    expect(hasUnsafeGitArg(['-C', '/elsewhere', 'status'])).toBe(true);
    expect(hasUnsafeGitArg(['--work-tree=/tmp', 'status'])).toBe(true);
    expect(hasUnsafeGitArg(['--git-dir=/tmp/repo', 'status'])).toBe(true);
    expect(hasUnsafeGitArg(['--exec-path=/tmp', 'status'])).toBe(true);
    expect(hasUnsafeGitArg(['--config-env=core.hooksPath=EV', 'status'])).toBe(true);
    expect(hasUnsafeGitArg(['-c=core.hooksPath=/tmp', 'status'])).toBe(true);
    expect(hasUnsafeGitArg(['--namespace=x', 'status'])).toBe(true);
  });

  it('does not confuse benign flags with unsafe ones', () => {
    expect(hasUnsafeGitArg(['status', '-sb'])).toBe(false);
    expect(hasUnsafeGitArg(['diff', '--stat'])).toBe(false);
  });
});
