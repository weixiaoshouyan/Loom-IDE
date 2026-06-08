import React from 'react';

interface Props {
  title: string;
  menuItems: { label: string; items: { label: string; shortcut?: string; action?: () => void; separator?: boolean }[] }[];
}

export default function TitleBar({ title, menuItems }: Props) {
  const [openMenu, setOpenMenu] = React.useState<number | null>(null);

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        {menuItems.map((menu, i) => (
          <div key={i} className="titlebar-menu-item" style={{ position: 'relative' }}
            onMouseDown={() => setOpenMenu(openMenu === i ? null : i)}
            onMouseEnter={() => { if (openMenu !== null) setOpenMenu(i); }}
          >
            {menu.label}
            {openMenu === i && (
              <>
                <div className="context-menu-overlay" onClick={() => setOpenMenu(null)} />
                <div className="context-menu" style={{ position: 'absolute', top: '100%', left: 0, minWidth: 200 }}>
                  {menu.items.map((item, j) =>
                    item.separator ? <div key={j} className="context-menu-sep" /> :
                    <div key={j} className="context-menu-item" onClick={() => { item.action?.(); setOpenMenu(null); }}>
                      <span>{item.label}</span>
                      {item.shortcut && <span className="command-item-keybinding">{item.shortcut}</span>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="titlebar-center">{title}</div>
      <div className="titlebar-right">
        <button className="titlebar-btn" title="Minimize" onClick={() => (window as any).loom?.window?.minimize()}><svg width="10" height="10" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg></button>
        <button className="titlebar-btn" title="Maximize" onClick={() => (window as any).loom?.window?.maximize()}><svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"/></svg></button>
        <button className="titlebar-btn close" title="Close" onClick={() => (window as any).loom?.window?.close()}><svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg></button>
      </div>
    </div>
  );
}
