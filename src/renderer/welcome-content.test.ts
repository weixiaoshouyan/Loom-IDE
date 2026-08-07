import { describe, expect, it, beforeEach } from 'vitest';
import { getWelcomeActions, getWelcomeShortcuts } from './welcome-content';
import { setLocale, getLocale } from '@/shared/i18n';

describe('welcome-content', () => {
  // Ensure we start from the default (OS-detected) locale.
  beforeEach(() => setLocale(getLocale()));

  it('provides four welcome actions with non-empty localized labels', () => {
    const labels = getWelcomeActions().map(action => action.label);
    expect(labels).toHaveLength(4);
    expect(labels.every(l => l.length > 0)).toBe(true);
  });

  it('provides AI shortcuts with non-empty localized labels', () => {
    const shortcuts = getWelcomeShortcuts();
    expect(shortcuts.length).toBeGreaterThan(0);
    expect(shortcuts.every(s => s.label.length > 0)).toBe(true);
  });

  it('returns English labels when locale is en-US', () => {
    setLocale('en-US');
    const labels = getWelcomeActions().map(action => action.label);
    expect(labels).toEqual(['New File', 'Open File...', 'Open Folder...', 'Open Settings']);
    setLocale('zh-CN');
  });

  it('returns Chinese labels when locale is zh-CN', () => {
    setLocale('zh-CN');
    const labels = getWelcomeActions().map(action => action.label);
    expect(labels).toEqual(['新建文件', '打开文件...', '打开文件夹...', '打开设置']);
    expect(labels.join(' ')).not.toMatch(/[�鈥]/);
  });
});
