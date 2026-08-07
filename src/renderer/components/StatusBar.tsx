import React, { useState, useEffect, useRef } from 'react';
import type { OpenFile } from '../App';
import { getLoom } from '../loom-ipc';

interface Props {
  workspacePath: string;
  activeFile: OpenFile | null;
  agentStatus?: 'online' | 'offline';
  aiMode?: 'orca' | 'builtin';
  orcaOnline?: boolean;
  theme?: 'dark' | 'light' | 'system';
  onThemeChange?: (theme: 'dark' | 'light' | 'system') => void;
  locale?: 'zh-CN' | 'en-US';
  gitBranch?: string | null;
  rulesActive?: boolean;
}

function StatusBar({
  workspacePath, activeFile, agentStatus = 'offline', aiMode = 'builtin', orcaOnline = false,
  theme = 'dark', onThemeChange, locale = 'zh-CN', gitBranch = null, rulesActive = false,
}: Props) {
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [tabSize, setTabSize] = useState(2);
  const [eol, setEol] = useState<'LF' | 'CRLF'>('LF');
  const [encoding, setEncoding] = useState('UTF-8');
  const [openMenu, setOpenMenu] = useState<'theme' | 'eol' | 'encoding' | 'locale' | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const containerRef = useRef<HTMLDivElement>(null);
  const [modelInfo, setModelInfo] = useState<{ provider: string; model: string; mode: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLoom()?.ai?.getConfig?.().then((c: any) => {
      if (cancelled || !c) return;
      const p = c.providers?.find((x: any) => x.id === c.activeProviderId);
      setModelInfo({
        provider: p?.name || c.activeProviderId || '',
        model: p?.activeModel || '',
        mode: c.mode || 'builtin',
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setCursor({ line: 1, col: 1 }); }, [activeFile?.path]);

  useEffect(() => {
    let cancelled = false;
    getLoom()?.settings?.getAll?.().then((s: any) => {
      if (cancelled || !s) return;
      if (s?.editor?.tabSize) setTabSize(s.editor.tabSize);
      if (s?.editor?.fontSize) setFontSize(s.editor.fontSize);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => setCursor({ line: e.detail.line, col: e.detail.column });
    window.addEventListener('loom:cursor-change' as any, handler);
    return () => window.removeEventListener('loom:cursor-change' as any, handler);
  }, []);

  // Close popups on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  const themeLabel = theme === 'dark' ? (locale === 'zh-CN' ? '深色' : 'Dark')
                   : theme === 'light' ? (locale === 'zh-CN' ? '浅色' : 'Light')
                   : (locale === 'zh-CN' ? '跟随系统' : 'System');

  return (
    <div className="statusbar" ref={containerRef}>
      <div className="statusbar-left">
        <div
          className="statusbar-item clickable"
          style={{ background: agentStatus === 'online' ? 'rgba(106,153,85,0.7)' : 'rgba(150,150,150,0.4)' }}
          title={agentStatus === 'offline'
            ? (locale === 'zh-CN' ? 'AI 未配置 — 点击打开设置' : 'AI not configured — click to open settings')
            : aiMode === 'orca' ? `Orca: ${orcaOnline ? 'Online' : 'Offline'}` : `AI: ${agentStatus === 'online' ? 'Online' : 'Offline'}`}
          onClick={() => { if (agentStatus === 'offline') window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openSettings' })); }}
        >
          <span className="statusbar-status-dot" style={{ background: agentStatus === 'online' ? '#6bfa6b' : 'rgba(255,255,255,0.5)' }} />
          AI {agentStatus === 'online' ? 'OK' : 'OFF'}
        </div>
        {workspacePath && (
          <div className="statusbar-item" title={workspacePath}>
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
            {workspacePath.split(/[\\/]/).pop()}
          </div>
        )}
        {gitBranch && (
          <div className="statusbar-item" title={`当前 Git 分支：${gitBranch}`}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="4" cy="3" r="1.6"/>
              <circle cx="4" cy="13" r="1.6"/>
              <circle cx="12" cy="6" r="1.6"/>
              <path d="M4 4.6v6.8M4 8h4a4 4 0 004-4v-.4"/>
            </svg>
            {gitBranch}
          </div>
        )}
        {modelInfo && (
          <div
            className="statusbar-item clickable"
            title={`当前模型：${modelInfo.provider} / ${modelInfo.model}（${modelInfo.mode === 'orca' ? 'Orca 代理' : '直连 API'}）`}
            onClick={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openSettings' }))}
          >
            <span className="statusbar-model-dot" />
            {modelInfo.provider || '未配置'} · {modelInfo.model || '—'}
          </div>
        )}
        {rulesActive && (
          <div className="statusbar-item rules-active" title="本工作区 AI 规则 (.loomrules) 已生效">
            <span className="statusbar-rules-dot" />
            规则生效
          </div>
        )}
      </div>
      <div className="statusbar-right">
        {activeFile && <div className="statusbar-item" style={{ fontVariantNumeric: 'tabular-nums' }}>Ln {cursor.line}, Col {cursor.col}</div>}
        {activeFile && <div className="statusbar-item">Spaces: {tabSize}</div>}
        {activeFile && <div className="statusbar-item">{activeFile.language?.charAt(0)?.toUpperCase?.() ?? ''}{activeFile.language?.slice(1) ?? 'Plain'}</div>}
        <div className="statusbar-item clickable" onClick={() => setOpenMenu(openMenu === 'encoding' ? null : 'encoding')}>
          {encoding}
          <span className="caret">▾</span>
          {openMenu === 'encoding' && (
            <div className="statusbar-popup" onClick={e => e.stopPropagation()}>
              {['UTF-8', 'UTF-16', 'GBK', 'ISO-8859-1'].map(enc => (
                <div key={enc} className={`statusbar-popup-item ${enc === encoding ? 'active' : ''}`}
                  onClick={() => { setEncoding(enc); setOpenMenu(null); }}>
                  {enc === encoding && '✓ '}{enc}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="statusbar-item clickable" onClick={() => setOpenMenu(openMenu === 'eol' ? null : 'eol')}>
          {eol}
          <span className="caret">▾</span>
          {openMenu === 'eol' && (
            <div className="statusbar-popup" onClick={e => e.stopPropagation()}>
              {(['LF', 'CRLF'] as const).map(e => (
                <div key={e} className={`statusbar-popup-item ${e === eol ? 'active' : ''}`}
                  onClick={() => { setEol(e); setOpenMenu(null); }}>
                  {e === eol && '✓ '}{e}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="statusbar-item clickable" onClick={() => setOpenMenu(openMenu === 'theme' ? null : 'theme')}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1"/>
            <path d="M8 2v6l4 2" fill="none" stroke="currentColor" strokeWidth="1"/>
          </svg>
          {themeLabel}
          <span className="caret">▾</span>
          {openMenu === 'theme' && (
            <div className="statusbar-popup" onClick={e => e.stopPropagation()}>
              {(['dark', 'light', 'system'] as const).map(th => (
                <div key={th} className={`statusbar-popup-item ${th === theme ? 'active' : ''}`}
                  onClick={() => { onThemeChange?.(th); setOpenMenu(null); }}>
                  {th === theme && '✓ '}
                  {th === 'dark' ? (locale === 'zh-CN' ? '深色' : 'Dark') : th === 'light' ? (locale === 'zh-CN' ? '浅色' : 'Light') : (locale === 'zh-CN' ? '跟随系统' : 'System')}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="statusbar-item" style={{ fontVariantNumeric: 'tabular-nums' }}>{fontSize}px</div>
        <div className="statusbar-item clickable" onClick={() => setOpenMenu(openMenu === 'locale' ? null : 'locale')} title={locale === 'zh-CN' ? '切换语言' : 'Switch Language'}>
          {locale === 'zh-CN' ? '🇨🇳 中文' : '🇺🇸 EN'}
          <span className="caret">▾</span>
          {openMenu === 'locale' && (
            <div className="statusbar-popup" onClick={e => e.stopPropagation()}>
              {[
                { id: 'zh-CN' as const, label: '🇨🇳 简体中文' },
                { id: 'en-US' as const, label: '🇺🇸 English' },
              ].map(l => (
                <div key={l.id} className={`statusbar-popup-item ${l.id === locale ? 'active' : ''}`}
                  onClick={() => { window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'locale', value: l.id } })); setOpenMenu(null); }}>
                  {l.id === locale && '✓ '}{l.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(StatusBar);
