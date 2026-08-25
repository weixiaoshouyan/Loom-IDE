import React, { useCallback, useEffect, useMemo, useState } from 'react';
import mockExtensions from '../../shared/marketplace-mock.json';
import { emitLoomEvent } from '../loom-events';

type ExtensionCategory = 'themes' | 'languages' | 'tools' | 'productivity' | 'ai' | 'other';
type QuickFilter = 'recommended' | 'installed' | 'cursor' | 'verified' | null;
type SortKey = 'downloads' | 'rating' | 'name';

interface Extension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  icon: string;
  category: ExtensionCategory;
  downloads: number;
  rating: number;
  installed: boolean;
  tags: string[];
  verified: boolean;
  homepage?: string;
  repository?: string;
}

interface MockExtension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  category: string;
  downloads?: number;
  rating?: number;
  tags?: string[];
  verified?: boolean;
}

interface Props {
  locale?: 'zh-CN' | 'en-US';
  embedded?: boolean;
  onInstalledChange?: () => void;
}

const COPY = {
  'zh-CN': {
    title: '扩展市场',
    refresh: '刷新扩展市场',
    search: '搜索扩展、作者、标签...',
    recommended: '推荐',
    verified: '已验证',
    installed: '已安装',
    extensions: '个扩展',
    loading: '加载中...',
    downloads: '下载量',
    rating: '评分',
    name: '名称',
    noResults: '未找到扩展',
    noResultsHint: '换个关键词或筛选条件试试',
    install: '安装',
    installing: '安装中',
    uninstall: '卸载',
    working: '处理中',
    retry: '重试',
    failed: '安装失败',
    trend: '下载趋势',
    category: '分类',
    permissions: '权限提示',
    permissionText: '可能读取工作区文件、注册命令、接入编辑器上下文。安装前请确认来源可信。',
    homepage: '主页',
    repository: '仓库',
    offline: '离线回退',
    all: '全部',
    themes: '主题',
    languages: '语言',
    tools: '工具',
    productivity: '效率',
    ai: 'AI',
    other: '其他',
  },
  'en-US': {
    title: 'Extensions',
    refresh: 'Refresh extensions',
    search: 'Search extensions, authors, tags...',
    recommended: 'Recommended',
    verified: 'Verified',
    installed: 'Installed',
    extensions: 'extensions',
    loading: 'Loading...',
    downloads: 'Downloads',
    rating: 'Rating',
    name: 'Name',
    noResults: 'No extensions found',
    noResultsHint: 'Try a different query or filter',
    install: 'Install',
    installing: 'Installing',
    uninstall: 'Uninstall',
    working: 'Working',
    retry: 'Retry',
    failed: 'Install failed',
    trend: 'Trend',
    category: 'Category',
    permissions: 'Permissions',
    permissionText: 'May read workspace files, register commands, and access editor context. Install trusted sources only.',
    homepage: 'Homepage',
    repository: 'Repository',
    offline: 'Offline fallback',
    all: 'All',
    themes: 'Themes',
    languages: 'Languages',
    tools: 'Tools',
    productivity: 'Productivity',
    ai: 'AI',
    other: 'Other',
  },
};

const CATEGORIES: Array<{ id: 'all' | ExtensionCategory; icon: string }> = [
  { id: 'all', icon: 'All' },
  { id: 'themes', icon: 'UI' },
  { id: 'languages', icon: 'Lang' },
  { id: 'tools', icon: 'Tool' },
  { id: 'productivity', icon: 'Flow' },
  { id: 'ai', icon: 'AI' },
  { id: 'other', icon: 'More' },
];

function normalizeCategory(category: string): ExtensionCategory {
  return ['themes', 'languages', 'tools', 'productivity', 'ai', 'other'].includes(category)
    ? category as ExtensionCategory
    : 'other';
}

function normalizeMarketplaceExtension(e: any): Extension {
  return {
    id: e.id,
    name: e.name || e.id,
    displayName: e.displayName || e.name || e.id,
    description: e.description || '',
    author: e.author || 'Unknown',
    category: normalizeCategory(e.category || 'other'),
    version: e.version || '0.0.0',
    downloads: e.downloads || e.downloadCount || 0,
    rating: e.rating || 0,
    icon: e.icon || e.iconUrl || 'Ext',
    tags: e.tags || e.compatibility || ['vscode', 'cursor', 'loom'],
    installed: !!e.installed,
    verified: !!e.verified,
    homepage: e.homepage,
    repository: e.repository || e.repoUrl,
  };
}

function buildFallbackExtensions(): Extension[] {
  return (mockExtensions as MockExtension[]).map(normalizeMarketplaceExtension);
}

function formatDownloads(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function isRecommended(ext: Extension): boolean {
  return ext.verified || ext.rating >= 4.6 || ext.downloads >= 1000000;
}

function trendLabel(ext: Extension): string {
  if (ext.downloads >= 1000000) return 'Hot';
  if (ext.downloads >= 50000) return 'Rising';
  return 'New';
}

export default function ExtensionMarketplace({ locale = 'zh-CN', embedded = false, onInstalledChange }: Props) {
  const copy = COPY[locale];
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<'all' | '__installed' | ExtensionCategory>('all');
  const [sortBy, setSortBy] = useState<SortKey>('downloads');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('recommended');
  const [selectedExt, setSelectedExt] = useState<Extension | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.loom?.marketplace?.list?.(searchQuery.trim() || undefined);
      setExtensions(Array.isArray(list) && list.length > 0 ? list.map(normalizeMarketplaceExtension) : buildFallbackExtensions());
    } catch (e) {
      setError((e as Error).message);
      setExtensions(buildFallbackExtensions());
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    reload();
  }, []);

  const installedCount = extensions.filter(e => e.installed).length;
  const recommendedCount = extensions.filter(isRecommended).length;

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return extensions
      .filter(ext => {
        if (category === '__installed' && !ext.installed) return false;
        if (category !== 'all' && category !== '__installed' && ext.category !== category) return false;
        if (quickFilter === 'recommended' && !isRecommended(ext)) return false;
        if (quickFilter === 'installed' && !ext.installed) return false;
        if (quickFilter === 'cursor' && !ext.tags.includes('cursor')) return false;
        if (quickFilter === 'verified' && !ext.verified) return false;
        if (!q) return true;
        return [ext.displayName, ext.name, ext.description, ext.author, ext.category, ...ext.tags]
          .some(value => value.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sortBy === 'downloads') return b.downloads - a.downloads;
        if (sortBy === 'rating') return b.rating - a.rating;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [category, extensions, quickFilter, searchQuery, sortBy]);

  const install = useCallback(async (ext: Extension) => {
    setInstalling(prev => new Set(prev).add(ext.id));
    setInstallErrors(prev => {
      const next = { ...prev };
      delete next[ext.id];
      return next;
    });
    try {
      const result = await window.loom?.marketplace?.install?.(ext.id);
      if (result && result.ok === false) {
        setInstallErrors(prev => ({ ...prev, [ext.id]: result.error || copy.failed }));
        return;
      }
      setExtensions(prev => prev.map(item => item.id === ext.id ? { ...item, installed: true } : item));
      emitLoomEvent('loom:notify', { message: `${copy.installed} ${ext.displayName}`, type: 'success' },);
      onInstalledChange?.();
    } catch (e: any) {
      setInstallErrors(prev => ({ ...prev, [ext.id]: e?.message || copy.failed }));
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(ext.id);
        return next;
      });
    }
  }, [copy.failed, copy.installed, onInstalledChange]);

  const uninstall = useCallback(async (ext: Extension) => {
    setInstalling(prev => new Set(prev).add(ext.id));
    try {
      await window.loom?.marketplace?.uninstall?.(ext.id);
      setExtensions(prev => prev.map(item => item.id === ext.id ? { ...item, installed: false } : item));
      onInstalledChange?.();
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(ext.id);
        return next;
      });
    }
  }, [onInstalledChange]);

  return (
    <>
      {!embedded && (
        <div className="sidebar-header">
          <span>{copy.title}</span>
          <div className="sidebar-header-actions">
            <button className="sidebar-header-btn" title={copy.refresh} aria-label={copy.refresh} data-testid="extensions-refresh" onClick={reload}>
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 8a4 4 0 014-4 4 4 0 013.5 2.1M13 6l-1.5 2.2M13 6l-1.5-2.2M12 8a4 4 0 01-4 4 4 4 0 01-3.5-2.1M3 10l1.5-2.2M3 10l1.5 2.2" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
          </div>
        </div>
      )}

      <div className="ext-marketplace-search">
        <div className="search-input-wrapper">
          <input
            className="search-input"
            placeholder={copy.search}
            aria-label={copy.search}
            data-testid="extensions-search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') reload(); }}
          />
        </div>
        <div className="ext-quick-filters">
          {[
            { id: 'recommended' as const, label: `${copy.recommended} ${recommendedCount}` },
            { id: 'cursor' as const, label: 'Cursor' },
            { id: 'verified' as const, label: copy.verified },
            { id: 'installed' as const, label: `${copy.installed} ${installedCount}` },
          ].map(filter => (
            <button
              key={filter.id}
              className={`ext-filter-chip ${quickFilter === filter.id ? 'active' : ''}`}
              aria-label={filter.label}
              data-testid={`extensions-filter-${filter.id}`}
              onClick={() => setQuickFilter(prev => prev === filter.id ? null : filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ext-marketplace-categories">
        {CATEGORIES.map(item => (
          <button
            key={item.id}
            className={`ext-category-btn ${category === item.id ? 'active' : ''}`}
            aria-label={`${copy.category} ${copy[item.id]}`}
            data-testid={`extensions-category-${item.id}`}
            onClick={() => setCategory(item.id)}
          >
            <span>{item.icon}</span>
            <span>{copy[item.id]}</span>
          </button>
        ))}
      </div>

      <div className="ext-marketplace-toolbar">
        <span className="ext-toolbar-count">
          {loading ? copy.loading : `${filtered.length} ${copy.extensions}`}
        </span>
        <div className="ext-toolbar-right">
          <select className="ext-sort-select" aria-label={copy.category} value={sortBy} onChange={event => setSortBy(event.target.value as SortKey)}>
            <option value="downloads">{copy.downloads}</option>
            <option value="rating">{copy.rating}</option>
            <option value="name">{copy.name}</option>
          </select>
          <button className="ext-view-toggle" data-testid="extensions-show-installed" onClick={() => { setCategory('__installed'); setQuickFilter(null); }}>
            {copy.installed} ({installedCount})
          </button>
        </div>
      </div>

      {error && <div className="ext-marketplace-note">{copy.offline}: {error}</div>}

      <div className="ext-marketplace-list">
        {filtered.length === 0 ? (
          <div className="panel-empty-state">
            <div>{copy.noResults}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{copy.noResultsHint}</div>
          </div>
        ) : filtered.map(ext => {
          const busy = installing.has(ext.id);
          const installError = installErrors[ext.id];
          return (
            <div
              key={ext.id}
              className={`ext-card ${selectedExt?.id === ext.id ? 'selected' : ''}`}
              data-testid="extension-card"
              onClick={() => setSelectedExt(selectedExt?.id === ext.id ? null : ext)}
            >
              <div className="ext-card-header">
                <span className="ext-card-icon">{ext.icon}</span>
                <div className="ext-card-info">
                  <div className="ext-card-name-row">
                    <span className="ext-card-name" title={ext.displayName}>{ext.displayName}</span>
                    {ext.verified && <span className="ext-badge verified">{copy.verified}</span>}
                    {ext.installed && <span className="ext-badge installed">{copy.installed}</span>}
                  </div>
                  <div className="ext-card-meta">
                    <span title={ext.author}>{ext.author}</span>
                    <span>{formatDownloads(ext.downloads)} {copy.installed.toLowerCase()}</span>
                    <span>{ext.rating.toFixed(1)}</span>
                    <span>v{ext.version}</span>
                  </div>
                  <div className="ext-card-badges">
                    {ext.tags.slice(0, 4).map(tag => <span key={tag} className="ext-badge">{tag}</span>)}
                  </div>
                </div>
                <div className="ext-card-actions">
                  {ext.installed ? (
                    <button className="ext-install-btn installed" aria-label={`${copy.uninstall} ${ext.displayName}`} data-testid="extension-uninstall" disabled={busy} onClick={event => { event.stopPropagation(); uninstall(ext); }}>
                      {busy ? copy.working : copy.uninstall}
                    </button>
                  ) : (
                    <button className="ext-install-btn" aria-label={`${installError ? copy.retry : copy.install} ${ext.displayName}`} data-testid="extension-install" disabled={busy} onClick={event => { event.stopPropagation(); install(ext); }}>
                      {busy ? copy.installing : installError ? copy.retry : copy.install}
                    </button>
                  )}
                </div>
              </div>

              {selectedExt?.id === ext.id && (
                <div className="ext-card-details" data-testid="extension-details">
                  <p className="ext-card-description">{ext.description}</p>
                  {installError && <div className="ext-install-error">{copy.failed}: {installError}</div>}
                  <div className="ext-card-stats">
                    <div className="ext-stat"><span className="ext-stat-label">{copy.trend}</span><span className="ext-stat-value">{trendLabel(ext)}</span></div>
                    <div className="ext-stat"><span className="ext-stat-label">{copy.rating}</span><span className="ext-stat-value">{ext.rating.toFixed(1)}/5</span></div>
                    <div className="ext-stat"><span className="ext-stat-label">{copy.category}</span><span className="ext-stat-value">{copy[ext.category]}</span></div>
                  </div>
                  <div className="ext-permissions">
                    <span>{copy.permissions}</span>
                    <span>{copy.permissionText}</span>
                  </div>
                  {(ext.homepage || ext.repository) && (
                    <div className="ext-card-links">
                      {ext.homepage && <button className="ext-link" onClick={event => { event.stopPropagation(); if (ext.homepage) window.loom?.shell?.openExternal?.(ext.homepage); }}>{copy.homepage}</button>}
                      {ext.repository && <button className="ext-link" onClick={event => { event.stopPropagation(); if (ext.repository) window.loom?.shell?.openExternal?.(ext.repository); }}>{copy.repository}</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
