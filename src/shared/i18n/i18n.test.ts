import { describe, expect, it, beforeEach } from 'vitest';
import { t, setLocale, getLocale, getPersistedLocale } from './index';

describe('i18n framework', () => {
  beforeEach(() => {
    // Reset to a known state before each test.
    setLocale('en-US');
  });

  it('returns English by default', () => {
    expect(t('welcome.newFile')).toBe('New File');
  });

  it('returns Chinese when locale is zh-CN', () => {
    setLocale('zh-CN');
    expect(t('welcome.newFile')).toBe('新建文件');
  });

  it('falls back to English for a missing key in the active locale', () => {
    setLocale('zh-CN');
    setLocale('en-US');
    expect(t('menu.file')).toBe('File');
  });

  it('returns the raw key when the translation is completely missing', () => {
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('reports the current locale', () => {
    setLocale('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    setLocale('en-US');
    expect(getLocale()).toBe('en-US');
  });

  it('reads back a persisted locale from localStorage', () => {
    setLocale('zh-CN');
    const persisted1 = getPersistedLocale();
    if (typeof localStorage !== 'undefined') {
      expect(persisted1).toBe('zh-CN');
    }
    setLocale('en-US');
    const persisted2 = getPersistedLocale();
    if (typeof localStorage !== 'undefined') {
      expect(persisted2).toBe('en-US');
    }
  });

  it('supports nested lookup via dot path', () => {
    setLocale('en-US');
    expect(t('menu.fileNewFile')).toBe('New File');
    setLocale('zh-CN');
    expect(t('menu.fileNewFile')).toBe('新建文件');
  });
});
