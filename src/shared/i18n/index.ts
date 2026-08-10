/**
 * Lightweight i18n framework for Loom IDE.
 *
 * Usage:
 *   import { t } from '@/shared/i18n';
 *   const label = t('sidebar.explorer');  // "资源管理器" or "Explorer"
 *
 * Locale cascade: saved setting > OS locale > 'en'.
 * The renderer reads locale from localStorage (synced from config on startup);
 * the main process reads it from app config.
 */
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

export type Locale = 'zh-CN' | 'en-US';

export interface I18nResources {
  [key: string]: string | I18nResources;
}

const LOCALE_KEY = 'loom.locale';

// ---- Resource tables ----------------------------------------------------------

const tables: Record<Locale, I18nResources> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

// ---- Locale detection ---------------------------------------------------------

function detectOsLocale(): Locale {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const raw = nav?.language || (Intl as any)?.DateTimeFormat?.()?.resolvedOptions?.()?.locale || '';
    return raw.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  } catch {
    return 'en-US';
  }
}

let _locale: Locale = detectOsLocale();

/** Get the current active locale. */
export function getLocale(): Locale {
  return _locale;
}

/**
 * Set the locale. Persists to localStorage on the renderer side so a manual
 * choice survives reloads. The caller (settings UI, App startup) is responsible
 * for also pushing the value to main-process config for OS-detection parity.
 */
export function setLocale(locale: Locale): void {
  _locale = locale;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCALE_KEY, locale);
    }
  } catch {
    // localStorage unavailable — ignore.
  }
}

/** Read a previously-persisted locale override (renderer-side). Stored by
 *  `setLocale()` or by App startup syncing from config. Returns null if none. */
export function getPersistedLocale(): Locale | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(LOCALE_KEY);
    return v === 'zh-CN' || v === 'en-US' ? v : null;
  } catch {
    return null;
  }
}

// ---- Lookup ------------------------------------------------------------------

/**
 * Translate a key. Supports dot-path nesting (e.g. 'sidebar.explorer').
 * Falls back to English, then to the raw key itself, so missing translations
 * never crash the UI.
 *
 * Optional params interpolate `{name}` placeholders in the resource string:
 *   t('fileTree.deleteFileConfirm', { name: 'src/main.ts' })
 *   → '确定删除 "src/main.ts"？'
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = lookup(key, _locale)
    ?? lookup(key, 'en-US')
    ?? '';
  let out = value || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.split(`{${k}}`).join(String(v));
    }
  }
  return out;
}

function lookup(key: string, locale: Locale): string | undefined {
  const parts = key.split('.');
  let node: any = tables[locale];
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

// Try to hydrate locale from persisted value on import.
const persisted = getPersistedLocale();
if (persisted) _locale = persisted;
