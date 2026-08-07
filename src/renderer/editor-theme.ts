export type AppTheme = 'dark' | 'light' | 'system';

export function resolveMonacoTheme(theme: AppTheme | string | null | undefined, systemPrefersDark: boolean): 'vs' | 'vs-dark' {
  if (theme === 'light') return 'vs';
  if (theme === 'dark') return 'vs-dark';
  return systemPrefersDark ? 'vs-dark' : 'vs';
}
