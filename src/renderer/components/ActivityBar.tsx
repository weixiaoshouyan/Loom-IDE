import React from 'react';
import { t } from '@/shared/i18n';

interface Props {
  activeView: string;
  onViewChange: (view: string) => void;
  aiOpen: boolean;
  onToggleAI: () => void;
  onSettings: () => void;
  /** Optional badge counts (e.g. git changes) shown on activity bar items. */
  badges?: Record<string, number>;
}

const Icons = {
  explorer: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>,
  git: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><line x1="12" y1="8.5" x2="12" y2="12"/><path d="M12 12L7 15.5"/><path d="M12 12L17 15.5"/></svg>,
  extensions: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>,
  ai: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  outline: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h12"/></svg>,
};

export default function ActivityBar({ activeView, onViewChange, aiOpen, onToggleAI, onSettings, badges = {} }: Props) {
  const topItems = [
    { id: 'explorer', icon: Icons.explorer, title: t('activity.explorer') },
    { id: 'search', icon: Icons.search, title: t('activity.search') },
    { id: 'git', icon: Icons.git, title: t('activity.sourceControl') },
    { id: 'outline', icon: Icons.outline, title: t('activity.outline') },
    { id: 'notepads', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>, title: t('activity.notepads') },
    { id: 'extensions', icon: Icons.extensions, title: t('activity.extensions') },
  ];

  return (
    <div className="activitybar">
      {/* Brand logo at top, Cursor-style. */}
      <div className="activitybar-brand" title="Loom IDE">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <defs>
            <linearGradient id="loom-brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="50%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <path d="M12 2L2 7l10 5 10-5-10-5z" fill="url(#loom-brand-grad)" />
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#loom-brand-grad)" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
      <div className="activitybar-top">
        {topItems.map(item => (
          <div
            key={item.id}
            className={`activitybar-item ${activeView === item.id ? 'active' : ''}`}
            title={item.title}
            role="button"
            tabIndex={0}
            aria-label={item.title}
            data-testid={`activity-${item.id}`}
            onClick={() => onViewChange(activeView === item.id ? '' : item.id)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') onViewChange(activeView === item.id ? '' : item.id);
            }}
          >
            {item.icon}
            {badges[item.id] > 0 && (
              <span className="activitybar-badge">{badges[item.id] > 99 ? '99+' : badges[item.id]}</span>
            )}
          </div>
        ))}
      </div>
      <div className="activitybar-bottom">
        <div
          className={`activitybar-item ${aiOpen ? 'active' : ''}`}
          title={t('activity.aiAgent')}
          role="button"
          tabIndex={0}
          aria-label={t('activity.aiAgent')}
          data-testid="activity-ai"
          onClick={onToggleAI}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') onToggleAI();
          }}
        >
          {Icons.ai}
        </div>
        <div
          className="activitybar-item"
          title={t('activity.settings')}
          role="button"
          tabIndex={0}
          aria-label={t('activity.settings')}
          data-testid="activity-settings"
          onClick={onSettings}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') onSettings();
          }}
        >
          {Icons.settings}
        </div>
      </div>
    </div>
  );
}
