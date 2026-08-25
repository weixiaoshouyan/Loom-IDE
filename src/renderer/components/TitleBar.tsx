import React, { useState, useEffect, useRef } from 'react';
import { getLoom } from '../loom-ipc';
import { t } from '@/shared/i18n';

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface Props {
  title: string;
  menuItems: { label: string; items: MenuItem[] }[];
}

export default function TitleBar({ title, menuItems }: Props) {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenu === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenu]);

  const handleMenuClick = (index: number) => {
    setOpenMenu(openMenu === index ? null : index);
  };

  const handleItemClick = (item: MenuItem) => {
    if (item.disabled) return;
    item.action?.();
    setOpenMenu(null);
  };

  return (
    <div className="titlebar" ref={containerRef}>
      <div className="titlebar-left" role="menubar">
        {menuItems.map((menu, i) => (
          <div
            key={i}
            className={`titlebar-menu-item ${openMenu === i ? 'open' : ''}`}
            onClick={() => handleMenuClick(i)}
            onMouseEnter={() => { if (openMenu !== null && openMenu !== i) setOpenMenu(i); }}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openMenu === i}
          >
            {menu.label}
            {openMenu === i && (
              <div className="titlebar-menu-dropdown" role="menu">
                {menu.items.map((item, j) =>
                  item.separator ? <div key={j} className="menu-sep" /> :
                  <div
                    key={j}
                    className={`menu-item ${item.disabled ? 'disabled' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleItemClick(item); }}
                    role="menuitem"
                    aria-disabled={item.disabled}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="titlebar-center">{title}</div>
      <div className="titlebar-right">
        <button className="titlebar-btn" title={t('titlebar.minimize')} aria-label={t('titlebar.minimize')} onClick={() => getLoom()?.window?.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="titlebar-btn" title={t('titlebar.maximize')} aria-label={t('titlebar.maximize')} onClick={() => getLoom()?.window?.maximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button className="titlebar-btn close" title={t('titlebar.close')} aria-label={t('titlebar.close')} onClick={() => getLoom()?.window?.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
