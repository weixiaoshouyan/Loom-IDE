/**
 * useThemeLocale — 主题 + 语言 领域 hook（App.tsx 拆出的模块）。
 *
 * 职责：
 *   - theme（dark/light/system）应用与持久化、跟随系统切换；
 *   - locale（zh-CN/en-US）同步到 i18n 框架；
 *   - 从 settings IPC 加载初始值，并订阅 loom:setting-change 事件总线热更新。
 */
import { useCallback, useEffect, useState } from 'react';
import { setLocale as setI18nLocale } from '@/shared/i18n';
import { onLoomEvent } from '../loom-events';

export type ThemeMode = 'dark' | 'light' | 'system';
export type Locale = 'zh-CN' | 'en-US';

export function useThemeLocale() {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [locale, setLocale] = useState<Locale>('zh-CN');

  const applyTheme = useCallback((t: ThemeMode) => {
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const syncI18nLocale = useCallback((loc: string) => {
    setI18nLocale(loc === 'zh-CN' ? 'zh-CN' : 'en-US');
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.loom?.settings?.getAll?.().then((s: any) => {
      if (cancelled || !s) return;
      const t = s.theme || 'dark';
      applyTheme(t);
      if (s.locale) {
        setLocale(s.locale);
        syncI18nLocale(s.locale);
      }
    }).catch(() => {});

    // Listen for system theme changes when in "system" mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const current = document.documentElement.getAttribute('data-theme');
      if (current === 'system') {
        document.documentElement.style.colorScheme = mq.matches ? 'dark' : 'light';
      }
    };
    mq.addEventListener?.('change', onSystemChange);
    document.documentElement.style.colorScheme = mq.matches ? 'dark' : 'light';

    const offSetting = onLoomEvent('loom:setting-change', ({ key, value }) => {
      if (key === 'theme') applyTheme(value as ThemeMode);
      if (key === 'locale') {
        setLocale(value as Locale);
        syncI18nLocale(value as string);
      }
    });
    return () => {
      cancelled = true;
      mq.removeEventListener?.('change', onSystemChange);
      offSetting();
    };
  }, [applyTheme, syncI18nLocale]);

  return { theme, locale, applyTheme, syncI18nLocale, setTheme, setLocale };
}
