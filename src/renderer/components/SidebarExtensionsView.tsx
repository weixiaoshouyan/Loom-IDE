import React, { useCallback, useEffect, useState } from 'react';
import ExtensionMarketplace from './ExtensionMarketplace';
import { confirmDialog } from './ConfirmModal';

export default function SidebarExtensionsView({ locale, workspacePath, onOpenFile }: { locale?: 'zh-CN' | 'en-US'; workspacePath?: string; onOpenFile?: (path: string, content: string) => void; }) {
  const [extensions, setExtensions] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Unified tab: 'marketplace' (online) or 'installed' (local plugins). */
  const [extTab, setExtTab] = useState<'marketplace' | 'installed'>('marketplace');
  /** Bump to force-refresh the Installed list after marketplace install/uninstall. */
  const [installedRev, setInstalledRev] = useState(0);

  const refresh = useCallback(() => {
    window.loom?.plugins?.getAll?.().then((plugins: any[]) => {
      setExtensions(plugins);
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh, installedRev]);

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    await window.loom?.plugins?.setEnabled?.(id, enabled);
    refresh();
    setBusy(null);
  };

  const uninstall = async (id: string) => {
    const ok = await confirmDialog.ask({
      title: locale === 'zh-CN' ? '卸载扩展' : 'Uninstall Extension',
      message: locale === 'zh-CN' ? `确认卸载扩展 "${id}"?` : `Uninstall extension "${id}"?`,
      confirmText: locale === 'zh-CN' ? '卸载' : 'Uninstall',
      danger: true,
    });
    if (!ok) return;
    setBusy(id);
    await window.loom?.plugins?.uninstall?.(id);
    refresh();
    setBusy(null);
  };

  const installFromFile = async () => {
    setBusy('__install__');
    try {
      const r = await window.loom?.plugins?.installFromFile?.();
      if (r?.ok) {
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: r.msg, type: 'success' } }));
        refresh();
      } else if (r?.msg) {
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: r.msg, type: 'error' } }));
      }
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: e.message, type: 'error' } }));
    }
    setBusy(null);
  };

  const openSamplePlugin = async () => {
    // Create a sample plugin folder in workspace if available
    if (!workspacePath || !onOpenFile) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: locale === 'zh-CN' ? '请先打开一个文件夹' : 'Open a folder first', type: 'info' } }));
      return;
    }
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const pluginDir = workspacePath + sep + '.loom-sample-plugin';
    try {
      await window.loom.fs.mkdir(pluginDir);
      const sep2 = sep;
      const pkg = {
        name: 'sample-hello-world',
        displayName: 'Hello World Sample',
        description: 'A minimal Loom plugin that registers one command',
        version: '1.0.0',
        author: 'You',
        main: './index.js',
        contributes: {
          commands: [{ command: 'sample.helloWorld', title: 'Hello World', category: 'Sample' }],
        },
      };
      const pkgPath = pluginDir + sep2 + 'package.json';
      const mainPath = pluginDir + sep2 + 'index.js';
      await window.loom.fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      const mainJs = `// Loom plugin: registers a single command "sample.helloWorld"\nfunction activate(api) {\n  api.registerCommand('sample.helloWorld', () => {\n    api.showInformationMessage('Hello from Loom plugin!');\n  });\n  api.showInformationMessage('Sample plugin activated.');\n}\nmodule.exports = { activate };\n`;
      await window.loom.fs.writeFile(mainPath, mainJs);
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: locale === 'zh-CN' ? '已创建示例插件,请在下方点击"从文件夹安装"加载它' : 'Sample plugin created, use "Install from folder" to load', type: 'success' } }));
      onOpenFile(mainPath, mainJs);
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: e.message, type: 'error' } }));
    }
  };

  const filtered = extensions.filter(e =>
    (e.manifest?.displayName || e.manifest?.name || e.id).toLowerCase().includes(filter.toLowerCase()) ||
    (e.manifest?.description || '').toLowerCase().includes(filter.toLowerCase())
  );

  const enabledCount = extensions.filter(e => e.enabled).length;

  return (
    <>
      <div className="sidebar-header">
        <span>{locale === 'zh-CN' ? '扩展' : 'EXTENSIONS'}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none' }}>
          {locale === 'zh-CN' ? `${enabledCount} / ${extensions.length} 已启用` : `${enabledCount} / ${extensions.length} enabled`}
        </span>
      </div>
      {/* Unified tab bar — Cursor/VSCode style */}
      <div className="ext-unified-tabs">
        <button
          className={`ext-unified-tab ${extTab === 'marketplace' ? 'active' : ''}`}
          onClick={() => setExtTab('marketplace')}
        >
          {locale === 'zh-CN' ? '市场' : 'Marketplace'}
        </button>
        <button
          className={`ext-unified-tab ${extTab === 'installed' ? 'active' : ''}`}
          onClick={() => { setExtTab('installed'); refresh(); }}
        >
          {locale === 'zh-CN' ? '已安装' : 'Installed'} ({extensions.length})
        </button>
      </div>

      {extTab === 'marketplace' ? (
        <ExtensionMarketplace
          locale={locale}
          embedded
          onInstalledChange={() => setInstalledRev(r => r + 1)}
        />
      ) : (
      <div className="sidebar-content">
        <div style={{ padding: '8px 10px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            className="search-input"
            placeholder={locale === 'zh-CN' ? '搜索已安装扩展' : 'Search installed'}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="settings-btn-sm primary"
              style={{ flex: 1, fontSize: 11 }}
              onClick={installFromFile}
              disabled={busy === '__install__'}
              title={locale === 'zh-CN' ? '从包含 package.json 的文件夹加载' : 'Install from a folder containing package.json'}
            >
              {locale === 'zh-CN' ? '+ 从文件夹安装' : '+ Install from Folder'}
            </button>
            <button
              className="settings-btn-sm"
              style={{ fontSize: 11 }}
              onClick={openSamplePlugin}
              title={locale === 'zh-CN' ? '在工作区创建示例插件' : 'Create a sample plugin in workspace'}
            >
              {locale === 'zh-CN' ? '示例' : 'Sample'}
            </button>
          </div>
        </div>
        <div style={{ padding: '0 6px' }}>
          {filtered.length === 0 ? (
            <div className="panel-empty-state">
              <div>{locale === 'zh-CN' ? '未找到扩展' : 'No extensions'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '点击"从文件夹安装"加载 .loom-sample-plugin' : 'Use "Install from Folder" to load a plugin'}</div>
            </div>
          ) : filtered.map(ext => {
            const isExpanded = expanded === ext.id;
            return (
              <div key={ext.id} className="settings-provider-card" style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : ext.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{ext.manifest?.displayName || ext.manifest?.name || ext.id}</span>
                      {ext.builtin && <span style={{ fontSize: 9, background: 'var(--accent)', color: 'white', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Built-in</span>}
                      {ext.activated && <span style={{ fontSize: 9, background: 'var(--green)', color: 'white', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Active</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ext.manifest?.description}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {ext.manifest?.author || 'Unknown'} · v{ext.manifest?.version || '1.0.0'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={ext.enabled}
                        disabled={ext.builtin || busy === ext.id}
                        onChange={e => toggle(ext.id, e.target.checked)}
                      />
                      <span className={`settings-toggle-slider ${ext.builtin ? 'disabled' : ''}`} />
                    </label>
                    {!ext.builtin && (
                      <button
                        className="settings-btn-sm"
                        style={{ color: 'var(--red)', fontSize: 10, padding: '2px 6px' }}
                        onClick={() => uninstall(ext.id)}
                        disabled={busy === ext.id}
                      >{locale === 'zh-CN' ? '卸载' : 'Uninstall'}</button>
                    )}
                  </div>
                </div>
                {isExpanded && ext.lastError && (
                  <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 6, padding: '4px 6px', background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                    ⚠ {ext.lastError}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}
    </>
  );
}
