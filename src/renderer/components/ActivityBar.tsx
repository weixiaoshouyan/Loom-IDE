import React from 'react';

interface Props {
  activeView: string;
  onViewChange: (view: string) => void;
  aiOpen: boolean;
  onToggleAI: () => void;
  onSettings: () => void;
}

const Icons = {
  explorer: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>,
  git: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><line x1="12" y1="8.5" x2="12" y2="12"/><path d="M12 12L7 15.5"/><path d="M12 12L17 15.5"/></svg>,
  extensions: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>,
  ai: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 3 4 3 4-3 4-3"/><circle cx="9" cy="9.5" r="1" fill="currentColor"/><circle cx="15" cy="9.5" r="1" fill="currentColor"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
};

export default function ActivityBar({ activeView, onViewChange, aiOpen, onToggleAI, onSettings }: Props) {
  const topItems = [
    { id: 'explorer', icon: Icons.explorer, title: 'Explorer (Ctrl+Shift+E)' },
    { id: 'search', icon: Icons.search, title: 'Search (Ctrl+Shift+F)' },
    { id: 'git', icon: Icons.git, title: 'Source Control (Ctrl+Shift+G)' },
    { id: 'outline', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h12"/></svg>, title: 'Outline' },
    { id: 'extensions', icon: Icons.extensions, title: 'Extensions' },
  ];

  return (
    <div className="activitybar">
      <div className="activitybar-top">
        {topItems.map(item => (
          <div key={item.id}
            className={`activitybar-item ${activeView === item.id ? 'active' : ''}`}
            title={item.title}
            onClick={() => onViewChange(activeView === item.id ? '' : item.id)}
          >
            {item.icon}
          </div>
        ))}
      </div>
      <div className="activitybar-bottom">
        <div className={`activitybar-item ${aiOpen ? 'active' : ''}`} title="Orca AI Agent" onClick={onToggleAI}>
          {Icons.ai}
        </div>
        <div className="activitybar-item" title="Settings (Ctrl+,)" onClick={onSettings}>
          {Icons.settings}
        </div>
      </div>
    </div>
  );
}
