import { describe, expect, it } from 'vitest';
import { resolveMonacoTheme } from './editor-theme';

describe('editor theme resolution', () => {
  it('resolves system theme from the actual OS preference', () => {
    expect(resolveMonacoTheme('system', false)).toBe('vs');
    expect(resolveMonacoTheme('system', true)).toBe('vs-dark');
  });

  it('keeps explicit light and dark choices stable', () => {
    expect(resolveMonacoTheme('light', true)).toBe('vs');
    expect(resolveMonacoTheme('dark', false)).toBe('vs-dark');
  });
});
