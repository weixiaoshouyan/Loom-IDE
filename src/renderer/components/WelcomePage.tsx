import React, { useEffect, useMemo, useState } from 'react';
import { t } from '@/shared/i18n';
import { getWelcomeActions, getWelcomeShortcuts } from '../welcome-content';
import { getLoom } from '../loom-ipc';
import { emitLoomEvent } from '../loom-events';

interface Props {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenFolderPath?: (folder: string) => void;
  onNewFile: () => void;
  onOpenSettings: () => void;
  locale?: string;
  workspacePath?: string;
}

const actionIcons: Record<string, React.ReactNode> = {
  newFile: <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinecap="round"/>,
  openFile: <path d="M4 2h5l3 3v9H4V2zm5 0v3h3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>,
  openFolder: <path d="M1.8 4.2h4.7l1.3 1.4h6.4v7.8H1.8V4.2z" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round"/>,
  settings: <path d="M8 5.4a2.6 2.6 0 100 5.2 2.6 2.6 0 000-5.2zm6 2.6l-1.5-.5-.4-1 0-1.6-1.6-.9-1.3.9-1.1-.2L6.9 3.4H5.1L4.3 4.8l-1.1.2-1.3-.9-1.6.9 0 1.6-.4 1L-1.6 8l.6 1.7 1.5.5.4 1 0 1.6 1.6.9 1.3-.9 1.1.2.8 1.4h1.8l.8-1.4 1.1-.2 1.3.9 1.6-.9 0-1.6.4-1 1.5-.5L14 8z" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinejoin="round"/>,
};

export default function WelcomePage({
  onOpenFile,
  onOpenFolder,
  onOpenFolderPath,
  onNewFile,
  onOpenSettings,
  locale = 'zh-CN',
  workspacePath,
}: Props) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [aiInfo, setAiInfo] = useState<{ provider: string; model: string } | null>(null);
  const [rulesActive, setRulesActive] = useState(false);
  const actions = useMemo(() => getWelcomeActions(), []);
  const shortcuts = useMemo(() => getWelcomeShortcuts(), []);

  useEffect(() => {
    getLoom()?.recent?.getFolders?.().then((folders: string[]) => {
      setRecentFolders(folders || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    getLoom()?.ai?.getConfig?.().then((c: any) => {
      if (!c) return;
      const p = c.providers?.find((x: any) => x.id === c.activeProviderId);
      setAiInfo({ provider: p?.name || c.activeProviderId || '', model: p?.activeModel || '' });
    }).catch(() => {});
    if (workspacePath) {
      const sep = workspacePath.includes('\\') ? '\\' : '/';
      const rulesPath = `${workspacePath.replace(/[\\/]+$/, '')}${sep}.loomrules`;
      getLoom()?.fs?.readFile?.(rulesPath).then(() => setRulesActive(true)).catch(() => setRulesActive(false));
    } else {
      setRulesActive(false);
    }
  }, [workspacePath]);

  const runAction = (id: string) => {
    if (id === 'newFile') onNewFile();
    if (id === 'openFile') onOpenFile();
    if (id === 'openFolder') onOpenFolder();
    if (id === 'settings') onOpenSettings();
  };

  return (
    <div className="welcome-page">
      <div className="welcome-hero">
        <div className="welcome-mark" aria-hidden="true">
          <span />
        </div>
        <h1 className="welcome-title">Loom IDE</h1>
        <p className="welcome-tagline">
          {t('welcome.tagline')}
        </p>

        <div className="welcome-ai-status">
          <span className="welcome-ai-chip">
            <span className="welcome-ai-chip-dot" />
            {aiInfo ? `${aiInfo.provider || t('welcome.notConfigured')} · ${aiInfo.model || '—'}` : t('agent.modelNotConfigured')}
          </span>
          {rulesActive && (
            <span className="welcome-ai-chip rules" title={t('welcome.rulesActiveTitleLoomrules')}>
              <span className="welcome-ai-chip-dot rules" />
              {t('welcome.rulesActiveChip')}
            </span>
          )}
          <button className="welcome-ai-setup" onClick={() => onOpenSettings()}>
            {t('welcome.configureModel')}
          </button>
        </div>

        <div className="welcome-primary-actions">
          {actions.map((action, index) => (
            <button
              key={action.id}
              className={`welcome-action ${index === 2 ? 'primary' : ''}`}
              onClick={() => runAction(action.id)}
            >
              <svg viewBox="0 0 16 16" width="18" height="18">{actionIcons[action.id]}</svg>
              <span>
                <strong>{action.label}</strong>
                <small>{action.detail}</small>
              </span>
              <span className="welcome-keybinding">
                {action.shortcut.map(key => <kbd key={key}>{key}</kbd>)}
              </span>
            </button>
          ))}
        </div>

        <div className="welcome-ai-strip">
          <button onClick={() => emitLoomEvent('loom:cmd', 'toggleAI')}>
            <span className="welcome-dot" />
            {t('welcome.openAgent')}
            <kbd>Ctrl+L</kbd>
          </button>
          <button onClick={() => emitLoomEvent('loom:editor-action', { action: 'inlineAI' })}>
            {t('welcome.inlineEdit')}
            <kbd>Ctrl+K</kbd>
          </button>
        </div>
      </div>

      <div className="welcome-lower">
        <section className="welcome-panel">
          <div className="welcome-panel-title">{t('welcome.recentProjects')}</div>
          {recentFolders.length > 0 ? (
            <div className="welcome-recent-list">
              {recentFolders.slice(0, 5).map(folder => (
                <button key={folder} onClick={() => onOpenFolderPath?.(folder)} title={folder}>
                  <span>{folder.split(/[\\/]/).pop()}</span>
                  <small>{folder}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="welcome-empty">{t('welcome.noRecentProjects')}</div>
          )}
        </section>

        <section className="welcome-panel">
          <div className="welcome-panel-title">{t('welcome.highFreqKeys')}</div>
          <div className="welcome-shortcuts-grid">
            {shortcuts.map(shortcut => (
              <div key={shortcut.key} className="welcome-shortcut-row">
                <kbd className="welcome-kbd">{shortcut.key}</kbd>
                <span>{shortcut.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
